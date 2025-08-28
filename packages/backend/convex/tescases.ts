import { ConvexError, v } from "convex/values";
import { requireAuth } from "./users";
import { mutation, query } from "./_generated/server";

// Workflow: First let a user create a problem, then he/she gets back problemId, use problemId field to disable `Add TestCase` Button.

const canModifyProblem = async (ctx: any, problemId: string) => {
  const { user } = await requireAuth(ctx);
  
  const problem = await ctx.db
    .query("problems")
    .withIndex("by_problem_id")
    .filter((q: any) => q.eq(q.field("problemId"), problemId))
    .first();

  if (!problem) {
    throw new ConvexError("Problem not found");
  }

  if (problem.creatorId !== user._id && user.role !== "ADMIN") {
    throw new ConvexError("Permission denied");
  }

  return { user, problem };
};

// Function to create test case
export const createTestCase = mutation({
  args: {
    problemId: v.string(),
    input: v.string(),
    output: v.string(),
    isPublic: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { problem } = await canModifyProblem(ctx, args.problemId);
    
    const testcaseId = `TC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const testcaseDocId = await ctx.db.insert("testcases", {
      testcaseId,
      input: args.input,
      output: args.output,
      isPublic: args.isPublic,
      problemId: problem._id,
    });

    await ctx.db.patch(problem._id, {
      testcases: [...problem.testcases, testcaseDocId], // Update the problem [Link Testcase to the problem]
      updatedAt: Date.now(),
    });

    return { message: "Testcase created successfully!", testcaseId };
  },
});

// Function to get test cases for a problem (admin/creator view)
export const getProblemTestCases = query({
  args: { 
    problemId: v.string(),
    publicOnly: v.optional(v.boolean()),
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

    // *** Nice suggstion: Good to have feature---
    let canSeeAll = false;
    if (!args.publicOnly) {
        const { user } = await requireAuth(ctx);
        canSeeAll = (problem.creatorId === user._id || user.role === "ADMIN");
    }
    // *** 

    const testcases = [];
    for (const testcaseId of problem.testcases) {
      const testcase = await ctx.db.get(testcaseId);
      if (testcase) {
        if (canSeeAll || args.publicOnly === false || testcase.isPublic) {
          testcases.push(testcase);
        }
      }
    }

    return testcases;
  },
});

// Function to update test case
export const updateTestCase = mutation({
  args: {
    testcaseId: v.string(),
    input: v.optional(v.string()),
    output: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
        const testcase = await ctx.db
            .query("testcases")
            .withIndex("by_test_case_id")
            .filter((q) => q.eq(q.field("testcaseId"), args.testcaseId))
            .first();

        if (!testcase) {
        throw new ConvexError("Test case not found");
        }

        const problem = await ctx.db.get(testcase.problemId);
        if (!problem) {
        throw new ConvexError("Associated problem not found");
        }

        const { user } = await requireAuth(ctx);
        if (problem.creatorId !== user._id && user.role !== "ADMIN") {
        throw new ConvexError("Permission denied");
        }

        const updates: any = {};
        Object.entries(args).forEach(([key, value]) => {
        if (key !== "testcaseId" && value !== undefined) {
            updates[key] = value;
        }
        });

        await ctx.db.patch(testcase._id, updates);
        
        return { message: "Successfully updated testcase." };
    } catch (error) {
        console.error("Update_testcase error: ", error);
        return { message: "Something went wrong. Try again later!" }
    }
  },
});

// Function to delete test case
export const deleteTestCase = mutation({
  args: { testcaseId: v.string() },
  handler: async (ctx, args) => {
    try {
        const testcase = await ctx.db
            .query("testcases")
            .withIndex("by_test_case_id")
            .filter((q) => q.eq(q.field("testcaseId"), args.testcaseId))
            .first();
        if (!testcase) {
        throw new ConvexError("Test case not found");
        }

        const problem = await ctx.db.get(testcase.problemId);
        if (!problem) {
            throw new ConvexError("Associated problem not found");
        }

        const { user } = await requireAuth(ctx);
        if (problem.creatorId !== user._id && user.role !== "ADMIN") {
            throw new ConvexError("Permission denied");
        }

        const updatedTestcases = problem.testcases.filter(id => id !== testcase._id);
        await ctx.db.patch(problem._id, {
            testcases: updatedTestcases,
            updatedAt: Date.now(),
        });

        await ctx.db.delete(testcase._id);
        
        return { success: true };
    } catch (error) {
        console.error("Delete_test_case: ", error);
        return { message: "Something went wrong. Try again later!" }
    }
  },
});

// Function to create multiple test cases at once
export const bulkCreateTestCases = mutation({
  args: {
    problemId: v.string(),
    testcases: v.array(v.object({
      input: v.string(),
      output: v.string(),
      isPublic: v.boolean(),
    })),
  },
  handler: async (ctx, args) => {
    try {
        const { problem } = await canModifyProblem(ctx, args.problemId);
    
    const createdTestCases = [];
    
    for (const tc of args.testcases) {
      const testcaseId = `TC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const testcaseDocId = await ctx.db.insert("testcases", {
        testcaseId,
        input: tc.input,
        output: tc.output,
        isPublic: tc.isPublic,
        problemId: problem._id,
      });
      
      createdTestCases.push(testcaseDocId);
    }

    await ctx.db.patch(problem._id, {
      testcases: [...problem.testcases, ...createdTestCases],
      updatedAt: Date.now(),
    });

    return {
        message: `Succesfully created ${createdTestCases.length} tescases`,
        success: true,  
    };
    } catch (error) {
        console.error("Buld_Testcase error: ", error);
        return {
        message: `Something went wrong. Try again later!`,
        success: false,  
    };
    }
  },
});

