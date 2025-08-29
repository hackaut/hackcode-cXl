import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./users";
import { Id } from "./_generated/dataModel";

// Function to create a new contest // Tested
export const createContest = mutation({
    args: {
        name: v.string(),
        description: v.string(),
        startTime: v.number(),
        endTime: v.number(),
        isPublic: v.boolean(),
        maxSize: v.number(),
        addSelf: v.boolean(),
    },
    handler: async (ctx, args) => {
        const { user } = await requireAuth(ctx);
        if (!user) {
            throw new ConvexError("User not found!");
        }

        // Validate the args
        const now = Date.now();
        if (args.startTime < now) {
            throw new ConvexError("Contest startTime cannot be in the past");
        }
        if (args.endTime <= args.startTime) {
            throw new ConvexError("Contest end time must be after start time");
        }
        if (args.maxSize <= 0) {
            throw new ConvexError("Max size must be positive");
        }

        const contestId = `contest_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const contestDocId = await ctx.db.insert("contests", {
            contestId,
            name: args.name.trim(),
            description: args.description.trim(),
            creatorId: user._id, // Changed here to keep consistency
            startTime: args.startTime,
            endTime: args.endTime,
            isPublic: args.isPublic,
            maxSize: args.maxSize,
            problems: [],
            users: (args.addSelf) ? [user._id] : [], // Think about this wisely...
            updatedAt: Date.now(),
        });

        await ctx.db.patch(user._id, {
        createdContests: [...user.createdContests, contestDocId],
        participatedContests: args.addSelf ?
            (user.participatedContests.includes(contestDocId) 
                ? user.participatedContests 
                : [...user.participatedContests, contestDocId]) 
            : user.participatedContests,
        });

        return { message: "Contest created successfully!", contestDocId };
    }
});

// Function to get all contests with filters // Tested
export const listContests = query({
    args: {
        filter: v.optional(v.union(
            v.literal("all"), // Decide whether to keep or not...
            v.literal("public"),
            v.literal("my_created"),
            v.literal("my_participated"),
            v.literal("upcoming"),
            v.literal("ongoing"),
            v.literal("ended"),
        )),
        limit: v.optional(v.number()),
        offset: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const { user } = await requireAuth(ctx);
        const filter = args.filter || "public";
        const limit = args.limit || 20;
        const offset = args.offset || 0;
        const now = Date.now();

        let contests;

        switch (filter) {
            case "all":
                if (!user) throw new ConvexError("Must be authenticated!");
                contests = await ctx.db.query("contests").collect();
                break;

            case "public":
                contests = await ctx.db
                    .query("contests")
                    .filter((q) => q.eq(q.field("isPublic"), true))
                    .collect();
                break;

            case "my_created":
                if (!user) throw new ConvexError("Must be authenticated");
                contests = await ctx.db
                    .query("contests")
                    .withIndex("by_creator_id", (q) => q.eq("creatorId", user.userId))
                    .collect();
                break;
            
            case "my_participated":
                if (!user) throw new ConvexError("Must be authenticated");
                contests = await ctx.db.query("contests").collect();
                contests = contests.filter(c => c.users.includes(user.userId));
                break;

            case "upcoming":
                contests = await ctx.db
                    .query("contests")
                    .filter((q) => q.and(
                        q.eq(q.field("isPublic"), true),
                        q.gt(q.field("startTime"), now)
                    ))
                    .collect();
                break;
      
            case "ongoing":
                contests = await ctx.db
                    .query("contests")
                    .filter((q) => q.and(
                        q.eq(q.field("isPublic"), true),
                        q.lte(q.field("startTime"), now),
                        q.gt(q.field("endTime"), now)
                    ))
                    .collect();
                break;
      
            case "ended":
                contests = await ctx.db
                    .query("contests")
                    .filter((q) => q.and(
                        q.eq(q.field("isPublic"), true),
                        q.lt(q.field("endTime"), now)
                    ))
                    .collect();
                break;
      
            default:
                contests = await ctx.db.query("contests")
                .filter((q) => q.eq(q.field("isPublic"), true))
                .collect();
        }

        // pq
        contests.sort((a, b) => {
            if (filter === "upcoming") return a.startTime - b.startTime;
            return b.startTime - a.startTime;
        });
        
        const paginatedContests = contests.slice(offset, offset + limit);

        // For contest card -> status, participatedCount, creatorId
        const contestsWithMeta = await Promise.all(
            paginatedContests.map(async (contest) => {
                let status = "upcoming";
                if (now >= contest.startTime && now < contest.endTime) status = "ongoing";
                if (now >= contest.endTime) status = "ended";

                const creator = await ctx.db.query("users").withIndex("by_user_id").filter(q => q.eq(q.field("userId"), contest.creatorId)).first();

                return {
                    ...contest,
                    status,
                    participantCount: contest.users.length,
                    problemCount: contest.problems.length,
                    creator: creator ? { name: creator.name, username: creator.username } : null,
                };
            })
        );

        return {
            contests: contestsWithMeta,
            total: contests.length,
            hasMore: offset + limit < contests.length,
        };
    }
});

// Function to get a specific problem details // Tested
export const getContestDetails = query({
    args: {
        contestId: v.string(),
    },
    handler: async (ctx, args) => {
        const { user } = await requireAuth(ctx);
        const contest = await ctx.db
            .query("contests")
            .withIndex("by_contest_id")
            .filter(q => q.eq(q.field("contestId"), args.contestId))
            .first();
        if (!contest) {
            throw new ConvexError("Contest not found!");
        }

        const isCreator = user && contest.creatorId === user.userId;
        const isParticipant = user && contest.users.includes(user.userId);

        if (!contest.isPublic && !isCreator && !isParticipant) {
            throw new ConvexError("Access Denied!");
        }

        const now = Date.now();
        let status = "upcoming";
        if (now >= contest.startTime && now < contest.endTime) status = "ongoing";
        if (now >= contest.endTime) status = "ended";

        const creator = await ctx.db.query("users").withIndex("by_user_id").filter(q => q.eq(q.field("userId"), contest.creatorId)).first();

        const contestProblemsData = await Promise.all(
            contest.problems.map(async (cpId, idx) => {
                const cp = await ctx.db.get(cpId);
                if (cp) {
                    const problem = await ctx.db.get(cp.problemId);
                    return {
                        ...cp,
                        problem: problem ? {
                        _id: problem._id,
                        problemId: problem.problemId,
                        title: problem.title,
                        difficulty: problem.difficulty,
                        tags: problem.tags,
                        sampleInput: problem.sampleInput,
                        sampleOuput: problem.sampleOutput,
                        order: (idx + 1)
                        } : null,
                    };
                }
                return null;
            })
        );

        const validContestProblems = contestProblemsData
            .filter(Boolean)
            .sort((a, b) => a!.order - b!.order); // Don't know how could this be null!!!

        return {
            ...contest,
            status,
            creator: creator ? { name: creator.name, username: creator.username } : null,
            contestProblems: validContestProblems,
            participantCount: contest.users.length,
            canJoin: user && !isParticipant && contest.users.length < contest.maxSize,
            isCreator,
            isParticipant,
        };
    },
});

// Function to update a contest // Fixed
export const updateContest = mutation({
    args: {
        contestId: v.string(),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        startTime: v.optional(v.number()),
        endTime: v.optional(v.number()),
        isPublic: v.optional(v.boolean()),
        maxSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const { user } = await requireAuth(ctx);
        if (!user) {
            throw new ConvexError("User not found!");
        }

        const contest = await ctx.db
            .query("contests")
            .withIndex("by_contest_id")
            .filter(q => q.eq(q.field("contestId"), args.contestId))
            .first();
        if (!contest) {
            throw new ConvexError("Contest not found!");
        }

        const isCreator = contest.creatorId === user._id; // Fixed this [user.userId -> user._id]
        const isAdmin = user.role === "ADMIN";
        
        if (!isCreator && !isAdmin) {
            throw new ConvexError("Only contest creator or admin can update contest");
        }

        const now = Date.now();
        const hasStarted = now >= contest.startTime;
        if (hasStarted) { // if contest is ongoing, only description can be changed...
            const allowedUpdates = { description: args.description };
            if (Object.keys(args).some(key => 
                key !== "contestId" && key !== "description"
            )) {
                throw new ConvexError("Can only update description for contests that have started");
            }
        }

        if (args.startTime !== undefined || args.endTime !== undefined) {
            const newStartTime = args.startTime ?? contest.startTime;
            const newEndTime = args.endTime ?? contest.endTime;
            
            if (!hasStarted && newStartTime < now) {
                throw new ConvexError("Contest start time cannot be in the past");
            }
            if (newEndTime <= newStartTime) {
                throw new ConvexError("Contest end time must be after start time");
            }
        }

        if (args.maxSize !== undefined) {
            if (args.maxSize <= 0) {
                throw new ConvexError("Max size must be positive");
            }
            if (args.maxSize < contest.users.length) {
                throw new ConvexError("Max size cannot be less than current participant count");
            }
        }

        const updateData: any = { updatedAt: Date.now() };
        if (args.name !== undefined) updateData.name = args.name.trim();
        if (args.description !== undefined) updateData.description = args.description.trim();
        if (args.startTime !== undefined) updateData.startTime = args.startTime;
        if (args.endTime !== undefined) updateData.endTime = args.endTime;
        if (args.isPublic !== undefined) updateData.isPublic = args.isPublic;
        if (args.maxSize !== undefined) updateData.maxSize = args.maxSize;

        await ctx.db.patch(contest._id, updateData);

        return { message: "Contest has been updated successfully!" }
    }
});

// Function to delete a contest // Tested
export const deleteContest = mutation({
  args: { contestId: v.string() }, // contest_xyz1234
  handler: async (ctx, args) => {
    const { user } = await requireAuth(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const contest = await ctx.db
      .query("contests")
      .withIndex("by_contest_id", (q) => q.eq("contestId", args.contestId))
      .unique();

    if (!contest) {
      throw new Error("Contest not found");
    }

    const isCreator = contest.creatorId === user._id;
    const isAdmin = user.role === "ADMIN";
    
    if (!isCreator && !isAdmin) {
      throw new Error("Only contest creator or admin can delete contest");
    }

    // Check if contest has submissions (prevent deletion if it has submissions)
    const hasSubmissions = await ctx.db
      .query("contestSubmissions")
      .withIndex("by_contest_id", (q) => q.eq("contestId", contest._id))
      .first();

    if (hasSubmissions) {
      throw new Error("Cannot delete contest with existing submissions");
    }

    // Delete contest problems
    const contestProblems = await ctx.db
      .query("contestProblems")
      .withIndex("by_contest_id", (q) => q.eq("contestId", contest._id))
      .collect();

    for (const cp of contestProblems) {
      await ctx.db.delete(cp._id);
    }

    // Remove contest from users' arrays
    const participants = await Promise.all(
      contest.users.map(userDocId => ctx.db.get(userDocId))
    );

    for (const participant of participants) {
      if (participant) {
        await ctx.db.patch(participant._id, {
          createdContests: participant.createdContests.filter(id => id !== contest._id),
          participatedContests: participant.participatedContests.filter(id => id !== contest._id),
        });
      }
    }

    // Delete the contest
    await ctx.db.delete(contest._id);

    return { message: "Contest deleted successfully", success: true };
  },
});

// Function to join a contest // Tested -> Think about how to handle private contests
export const joinContest = mutation({
  args: { contestId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireAuth(ctx);
    if (!user) {
      throw new ConvexError("User not found");
    }

    const contest = await ctx.db
      .query("contests")
      .withIndex("by_contest_id", (q) => q.eq("contestId", args.contestId))
      .unique();

    if (!contest) {
      throw new ConvexError("Contest not found");
    }

    // Check if contest is public or user is invited
    if (!contest.isPublic) {
      throw new ConvexError("Contest is private");
    }

    // Check if already joined
    if (contest.users.includes(user._id)) {
      throw new ConvexError("Already joined this contest");
    }

    // Check capacity
    if (contest.users.length >= contest.maxSize) {
      throw new ConvexError("Contest is full");
    }

    // Check if contest has ended
    if (Date.now() > contest.endTime) {
      throw new ConvexError("Contest has ended");
    }

    // Join contest
    await ctx.db.patch(contest._id, {
      users: [...contest.users, user._id],
      updatedAt: Date.now(),
    });

    // Update user's participated contests
    await ctx.db.patch(user._id, {
      participatedContests: [...user.participatedContests, contest._id],
    });

    return { message: `Joined contest: ${contest.name} successfully`, success: true };
  },
});

// Function to leave a contest // Tested
export const leaveContest = mutation({
  args: { contestId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireAuth(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const contest = await ctx.db
      .query("contests")
      .withIndex("by_contest_id", (q) => q.eq("contestId", args.contestId))
      .unique();

    if (!contest) {
      throw new Error("Contest not found");
    }

    // Check if user is in contest
    if (!contest.users.includes(user._id)) {
      throw new Error("Not participating in this contest");
    }

    // Check if contest has started
    if (Date.now() >= contest.startTime) {
      throw new Error("Cannot leave contest after it has started");
    }

    // Remove user from contest
    await ctx.db.patch(contest._id, {
      users: contest.users.filter(id => id !== user._id),
      updatedAt: Date.now(),
    });

    // Update user's participated contests
    await ctx.db.patch(user._id, {
      participatedContests: user.participatedContests.filter((id: Id<"contests">) => id !== contest._id),
    });

    return { message: "Successfully left the contest", success: true };
  },
});