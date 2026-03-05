import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          // 指定したWorkspaceドメインのユーザーのみログインを許可
          hd: process.env.ALLOWED_DOMAIN,
          // Drive APIのフルアクセス権限を要求
          scope: "openid email profile https://www.googleapis.com/auth/drive",
        },
      },
    }),
  ],
  callbacks: {
    // ログイン時にアクセストークンをJWTに保存
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    // クライアント側（やAPIルート）でトークンを使えるようにセッションに渡す
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };