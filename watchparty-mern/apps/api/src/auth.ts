import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./config.js";

export interface AuthClaims {
  userId: string;
  email: string;
  displayName: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthClaims;
}

export function signToken(claims: AuthClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: "7d" });
}

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  const value = req.header("authorization");
  if (!value || !value.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing token" });
    return;
  }
  const token = value.replace("Bearer ", "");
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthClaims;
    req.auth = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
