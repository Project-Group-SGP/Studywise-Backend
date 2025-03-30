import type { Response } from "express";
import { db } from "../../prismaClient";
import { TokenPayload } from "types";
import { Liveblocks } from "@liveblocks/node";

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET!,
});

export async function liveblocksAuth(req: any, res: Response) {
  const user = req.user as TokenPayload;
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const {room} = await req.json();
  const { groupId, id: boardId } = req.params;
  const board = await db.board.findUnique({
    where: { id: room, groupId },
  });
  if (!board) {
    return res.status(404).json({ message: "Board not found" });
  }
  if(board?.groupId!==groupId){
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userInfo = {
    name:user.name || "Ananymous",
    picture:user.picture!,
  }
  console.log("userInfo: ",{ userInfo });
  // Start an auth session inside your endpoint
  const session = liveblocks.prepareSession(
    user.id,
    { userInfo:userInfo } // Optional
  );

  // Use a naming pattern to allow access to rooms with wildcards
  // Giving the user read access on their org, and write access on their group
  if(room){
    session.allow(room, session.FULL_ACCESS);
  }

  // Authorize the user and return the result
  const { status, body } = await session.authorize();

  console.log({status,body},"ALLOWED");
  return new Response(body, { status });
}

