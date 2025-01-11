import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { getCurrentUser } from "lib/user";
dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET;

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const user = jwt.verify(token, JWT_SECRET!);
    console.log("User", user);
    //@ts-ignore
    req.user = user;

    console.log("Authenticated user:", getCurrentUser(req));
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};
