import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import { getDatabase } from "../db/client";
import { authConfig, type SessionData } from "./auth-config";
import { authenticate } from "./auth-service";
import { AppError } from "./errors";

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), authConfig().options);
}

export async function requireOrganizer() {
  const session = await getSession();
  return authenticate(getDatabase(), session.token);
}

export async function requirePageOrganizer() {
  try {
    return await requireOrganizer();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login");
    throw error;
  }
}
