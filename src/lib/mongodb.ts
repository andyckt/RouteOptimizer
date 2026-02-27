import mongoose from "mongoose";
import { getServerEnv } from "@/lib/env";

let isConnected = false;

export async function connectDB(): Promise<typeof mongoose> {
  if (isConnected) {
    return mongoose;
  }
  const { MONGODB_URI } = getServerEnv();
  const conn = await mongoose.connect(MONGODB_URI);
  // Wait for connection to actually be ready (mongoose.connect can resolve while readyState is still "connecting")
  if (conn.connection.readyState !== 1) {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        conn.connection.removeListener("connected", finish);
        conn.connection.removeListener("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        conn.connection.removeListener("connected", finish);
        conn.connection.removeListener("error", onError);
        reject(err);
      };
      conn.connection.once("connected", finish);
      conn.connection.once("error", onError);
      setImmediate(() => {
        if (conn.connection.readyState === 1) finish();
      });
    });
  }
  isConnected = true;
  return conn;
}
