import {db} from "../prismaClient";

export async function getUserByEmail(email: string) {
  return await db.user.findUnique({where: {email}});
}

export async function getUserById(id: string) {
  return await db.user.findUnique({where: {id}});
}
