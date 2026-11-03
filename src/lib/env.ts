import "server-only";
import { parseServerEnvironment } from "./env-validation";

export function getServerEnvironment() {
  return parseServerEnvironment(process.env);
}
