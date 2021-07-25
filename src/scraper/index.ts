import "dotenv/config";
import "./config";

import { isNil, isEmpty, flatMap } from "lodash";
import axios from "axios";
import puppeteer from "puppeteer";

import bot from "../bot";
import { connect } from "../db";
import getLatestSnapshot from "../db/queries/getLatestSnapshot";
import gyms from "./gyms";
import sessions from "./sessions";
import calculateChanges from "./shared/helpers/calculateChanges";

import type { SnapshotData } from "../db/models/snapshot";
import type { Context } from "./context";

const isProduction = process.env.NODE_ENV === "production";

const SCRAPERS = [
  { resource: "gyms", scrape: gyms },
  { resource: "sessions", scrape: sessions },
];

const main = async () => {
  const adminBot = bot.create({
    token: process.env.TELEGRAM_BOT_TOKEN,
    botURL: process.env.BOT_SERVER_URL,
    adminChannel: process.env.ADMIN_CHANNEL,
  });

  const db = connect();

  const browser = await puppeteer.launch({
    headless: isProduction,
    defaultViewport: null,
    args: isProduction ? ["--no-sandbox"] : [],
  });

  const ctx: Context = {
    db,
    browser,
    http: axios,
    adminBot,
  };

  const results = await Promise.all(
    SCRAPERS.map(async ({ resource, scrape }) => {
      const result = await scrape(ctx);
      return { resource, result };
    }),
  );

  const previousSnapshot = await getLatestSnapshot(ctx.db);
  const previousData = previousSnapshot?.data;

  const data: SnapshotData = {};
  results.forEach(({ resource, result }) => {
    if (result) {
      data[resource] = result;
    }
  });

  const changes = calculateChanges(previousData, data);
  console.log(JSON.stringify(changes, null, 4));

  const numberOfChanges = flatMap(Object.values(changes), (d) => d.data).length;

  // Report errors
  const errors = Object.keys(data.sessions).filter(
    (gym) => !isNil(data.sessions[gym].error),
  );

  if (!isEmpty(errors) && numberOfChanges > 0) {
    await adminBot.sendToAdminChannel(
      "Scraper errors detected:",
      errors
        .map((gym) => `${gym} - ${data.sessions[gym].error.message}`)
        .join("\n"),
    );
  }

  await ctx.db("snapshots").insert({ data });

  await db.destroy(); // Close DB connection

  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
