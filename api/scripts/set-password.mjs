import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const email = String(process.argv[2] || "").trim().toLowerCase();
const password = String(process.argv[3] || "");

if (!email || password.length < 6) {
  console.error("Usage: node scripts/set-password.mjs <email> <new-password>");
  process.exit(1);
}

const prisma = new PrismaClient();
const hashed = await bcrypt.hash(password, 10);
const user = await prisma.user.update({
  where: { email },
  data: { password: hashed },
  select: { id: true, email: true }
});
console.log(`Updated password for ${user.email}`);
await prisma.$disconnect();
