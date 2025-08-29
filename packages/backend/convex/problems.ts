import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./users";

// Function to create a new problem // Tested
export const createProblem = mutation({
    args: {
        title: v.string(),
        description: v.string(),
        timeLimit: v.number(), // in seconds
        memoryLimit: v.number(), // in MB
        difficulty: v.optional(v.union(v.literal("EASY"), v.literal("MEDIUM"), v.literal("HARD"))),
        tags: v.optional(v.array(v.string())),
        sampleInput: v.optional(v.string()),
        sampleOutput: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        try {
            const { user } = await requireAuth(ctx);
            console.log("User: ", user)

            const problemId = `PROB_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const problemDocId = await ctx.db.insert("problems", {
                problemId,
                title: args.title,
                description: args.description,
                creatorId: user._id,
                timeLimit: args.timeLimit,
                memoryLimit: args.memoryLimit,
                difficulty: args.difficulty || "MEDIUM",
                tags: args.tags || [],
                sampleInput: args.sampleInput,
                sampleOutput: args.sampleOutput,
                testcases: [],
                contests: [],
                submissions: [],
                updatedAt: Date.now(),
            });

            await ctx.db.patch(user._id, {
                createdProblems: [...user.createdProblems, problemDocId],
            });

            return { message: "Problem added successfully!", problemId }
        } catch (error) {
            console.error("createProblem Error: ", error);
            return { message: "Something went wrong. Try again later!" }
        }
    }
});

// Function to list all problems with filters // Tested
export const listProblems = query({
  args: {
    difficulty: v.optional(v.union(v.literal("EASY"), v.literal("MEDIUM"), v.literal("HARD"))),
    tags: v.optional(v.array(v.string())),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let problems = ctx.db.query("problems"); // collect all problems first
    
    if (args.difficulty) {
      problems = problems.filter((q) => q.eq(q.field("difficulty"), args.difficulty)); // If difficulty filter applied
    }
    
    let results = await problems.collect();
    
    if (args.tags && args.tags.length > 0) {
      results = results.filter(p => 
        args.tags!.some(tag => p.tags?.includes(tag))
      );
    }
    
    if (args.search) {
      const searchLower = args.search.toLowerCase();
      results = results.filter(problem =>
        problem.title.toLowerCase().includes(searchLower) ||
        problem.description.toLowerCase().includes(searchLower)
      );
    }
    
    if (args.limit) {
      results = results.slice(0, args.limit);
    }
    
    return results.map(problem => ({
      ...problem,
      testcases: [],
    }));
  },
});

// Function to get single problem with full details // Tested
export const getProblem = query({
  args: { problemId: v.string() },
  handler: async (ctx, args) => {
    const problem = await ctx.db
      .query("problems")
      .withIndex("by_problem_id")
      .filter((q) => q.eq(q.field("problemId"), args.problemId))
      .first();

    if (!problem) {
      throw new ConvexError("Problem not found");
    }

    const creator = await ctx.db.get(problem.creatorId);
    
    // Get public test cases only (for regular users)
    const publicTestcases = [];
    for (const testcaseId of problem.testcases) {
      const testcase = await ctx.db.get(testcaseId);
      if (testcase && testcase.isPublic) {
        publicTestcases.push(testcase); // show public testcases at the bottom
      }
    }

    return {
      ...problem,
      creator: creator ? { name: creator.name, username: creator.username } : null,
      testcases: publicTestcases,
    };
  },
});

// Function to get problem for creator/admin (with all testCases) // Tested
export const getProblemForEdit = mutation({
    args: {
        problemId: v.string(),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        timeLimit: v.optional(v.number()), // in seconds
        memoryLimit: v.optional(v.number()), // in MB
        difficulty: v.optional(
          v.union(v.literal("EASY"), v.literal("MEDIUM"), v.literal("HARD"))
        ),
        tags: v.optional(v.array(v.string())),
        sampleInput: v.optional(v.string()),
        sampleOutput: v.optional(v.string())
    },
    handler: async (ctx, args) => {
        try {
          const { user } = await requireAuth(ctx);

          const problem = await ctx.db
            .query("problems")
            .withIndex("by_problem_id")
            .filter(q => q.eq(q.field("problemId"), args.problemId))
            .first();

          if (!problem) {
            throw new ConvexError("Problem not found");
          }

          if (problem.creatorId !== user._id && user.role !== "ADMIN") { // Either the one who created or an admin can edit a problem
            throw new ConvexError("Permission denied");
          }

          const updates: any = { updatedAt: Date.now() };
      
          // *** Only update provided fields -- Good suggestion, protects from intentional change of problemId ***
          Object.entries(args).forEach(([key, value]) => {
            if (key !== "problemId" && value !== undefined) {
              updates[key] = value;
            }
          });
          // ***

          await ctx.db.patch(problem._id, updates);
          
          return { message: "Problem updated successfully" };
        } catch (error) {
          console.error("Problem Edit error: ", error);
          return { message: "Something went wrong. Try again later!" }
        }
    }
});

// Function to delete problem // Tested
export const deleteProblem = mutation({
  args: { problemId: v.string() },
  handler: async (ctx, args) => {
    try {
      const { user } = await requireAuth(ctx);
    
      const problem = await ctx.db
        .query("problems")
        .withIndex("by_problem_id")
        .filter((q) => q.eq(q.field("problemId"), args.problemId))
        .first();

      if (!problem) {
        throw new ConvexError("Problem not found");
      }

      if (problem.creatorId !== user._id && user.role !== "ADMIN") { /// Admin or creator is permitted to do this action
        throw new ConvexError("Permission denied");
      }

      // Delete associated test cases
      for (const testcaseId of problem.testcases) {
        await ctx.db.delete(testcaseId);
      }

      const creator = await ctx.db.get(problem.creatorId);
      if (creator) {
        const updatedCreatedProblems = creator.createdProblems.filter( // keep other problems...
          (id) => id !== problem._id
        );
        await ctx.db.patch(creator._id, {
          createdProblems: updatedCreatedProblems,
        });
      }

      // Delete the problem
      await ctx.db.delete(problem._id);
      
      return { message: "Problem deleted successfully!" };
    } catch (error) {
      console.error("Delete problem error: ", error);
      return { message: "Something went wrong. Try again later!" };
    }
  },
});

// Function to get all the problems created by the user // Fixed
export const getUserProblems = query({
  handler: async (ctx) => {
    const  { user } = await requireAuth(ctx);

    if (!user) {
      return [];
    }

    const problems = await ctx.db
      .query("problems")
      .withIndex("by_creator_id")
      .filter(q => q.eq(q.field("creatorId"), user._id)) // This requied fix... [user.userId -> user._id]
      .collect();

    return { problems };
  }
});

// Function to get particular problem stat // Remaigning
export const getProblemStats = query({
  args: { 
    problemId: v.string()
  },
  handler: async (ctx, args) => {
    const problem = await ctx.db
      .query("problems")
      .withIndex("by_problem_id")
      .filter((q) => q.eq(q.field("problemId"), args.problemId))
      .first();

    if (!problem) {
      throw new ConvexError("Problem not found");
    }

    const stats = await ctx.db
      .query("problemStats")
      .withIndex("by_problem_id")
      .filter((q) => q.eq(q.field("problemId"), problem._id))
      .first();

    if (!stats) {
      return { message: "No stats availble for the specific problem!" }
    }

    const totalSubmissions = stats.totalSubmissions;
    const acceptedSubmissions = stats.acceptedSubmissions;
    const acceptanceRate = totalSubmissions > 0 ? (acceptedSubmissions / totalSubmissions) * 100 : 0;

    return {
      totalSubmissions,
      acceptedSubmissions,
      acceptanceRate: Math.round(acceptanceRate * 100) / 100,
      difficulty: problem.difficulty,
    };
  },
});