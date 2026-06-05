import { json } from "./http.ts";
import {
  getUserProfile,
  insertUserProfile,
  requireWorkerDatabaseAccess,
} from "./db.ts";

// Minimal structural interface covering the env fields used by auth helpers.
// The full Env type in index.ts is a superset that satisfies this interface.
type AuthEnv = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_REST_KEY: string;
  WORKER_API_SECRET: string;
};

export type AuthUser = {
  id: string;
  email?: string;
  role: "user" | "admin";
  banned_at: string | null;
};

export async function getUserFromToken(token: string, env: AuthEnv): Promise<AuthUser> {
  requireWorkerDatabaseAccess(env);
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) throw new Error(`Supabase auth returned ${response.status}`);
  const raw = await response.json<{ id: string; email?: string }>();
  const profile = await getUserProfile(env, raw.id);

  if (!profile) {
    await insertUserProfile(env, raw.id, raw.email?.split("@")[0] ?? "User");
  }

  return {
    id: raw.id,
    email: raw.email,
    role: profile?.role ?? "user",
    banned_at: profile?.banned_at ?? null
  };
}

export async function getOptionalUser(request: Request, env: AuthEnv): Promise<AuthUser | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return await getUserFromToken(header.slice("Bearer ".length), env);
  } catch {
    return null;
  }
}

export async function requireUser(request: Request, env: AuthEnv): Promise<AuthUser | Response> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);
  try {
    return await getUserFromToken(header.slice("Bearer ".length), env);
  } catch {
    return json({ error: "Invalid session." }, 401);
  }
}

export async function requireAdmin(request: Request, env: AuthEnv): Promise<AuthUser | Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  if (user.role !== "admin") return json({ error: "Admin access required." }, 403);
  return user;
}
