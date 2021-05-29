import type { Session } from "./session";

export type Snapshot = {
  id: string;
  data: SnapshotData;
  created_at: Date;
};

export type SnapshotData = {
  sessions?: {
    [name: string]:
      | { data: Session[]; error: undefined }
      | { data: undefined; error: { message: string } };
  };
};
