import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Function to sync a new user to our database
export const syncUser = mutation({
  args: {
    userId: v.string(),
    email: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existingUser = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    const username = `${args.name}_${randomNumber}`

    if (!existingUser) {
      await ctx.db.insert("users", {
        userId: args.userId,
        email: args.email,
        name: args.name,
        username: username,
        isVerified: false,
        role: "USER",
        createdContests: [],
        createdProblems: [],
        participatedContests: [],
        solvedProblems: []
      });
    }
    
    // TODO: Push to sns for email notification. (Simple notification system)
  },
});

// Function to get a specific user => To show others' stats
export const getUser = query({
  args: { 
    userId: v.string() 
  },

  handler: async (ctx, args) => {
    if (!args.userId) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_user_id")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    console.log("User: ", user);

    if (!user) return null;

    return user;
  },
});

// Function to get authenticated user => useAuthState
export const getCurrentUser = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return null;
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_user_id")
            .filter((q) => q.eq(q.field("userId"), identity.subject))
            .first();

        return user;
    }
});

export const getMany = query({
    args: {},
    handler: async (ctx) => {
        const users = await ctx.db.query("users").collect();

        return users;
    }
});