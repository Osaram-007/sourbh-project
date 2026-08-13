import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { db } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  providers: [
    // Email credentials login (replaces Google OAuth to support clean login without Google API setup)
    CredentialsProvider({
      id: "email-login",
      name: "Email Login",
      credentials: {
        email: { label: "Email Address", type: "email", placeholder: "user@example.com" },
        role: { label: "Role (ADMIN or USER)", type: "text", placeholder: "ADMIN" }
      },
      async authorize(credentials) {
        if (!credentials) return null;

        const isProd = process.env.NODE_ENV === "production";
        const email = credentials.email || "user@example.com";
        // In production, the role field submitted at login is never trusted:
        // new users are always USER, and an existing user's role is never
        // mutated by logging in. Promote the first admin via a direct DB
        // update instead — this is the fix for a login-time privilege
        // escalation bug (anyone could log in as ADMIN for any email).
        const requestedRole = (credentials.role || "USER").toUpperCase();
        const role = !isProd && requestedRole === "ADMIN" ? "ADMIN" : "USER";

        // Find or create the user record dynamically in the database
        let user = await db.user.findUnique({ where: { email } });
        if (!user) {
          user = await db.user.create({
            data: {
              email,
              name: email.split("@")[0],
              role
            }
          });
        } else if (!isProd && user.role !== role) {
          user = await db.user.update({
            where: { id: user.id },
            data: { role }
          });
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role || "USER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
