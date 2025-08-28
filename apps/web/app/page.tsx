"use client";


import { SignInButton, UserButton } from "@clerk/nextjs";
import { api } from "@workspace/backend/_generated/api";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";

export default function Page() {
  const users = useQuery(api.users.getMany)
  return (
    <div className="flex items-center justify-center min-h-svh">
      <div className="flex flex-col items-center justify-center gap-4">
        <Authenticated>
          <UserButton />
        </Authenticated>
        <Unauthenticated>
          <SignInButton />
        </Unauthenticated>
        <h1 className="text-2xl font-bold">Hello World</h1>
        {JSON.stringify(users)}
      </div>
    </div>
  )
}
