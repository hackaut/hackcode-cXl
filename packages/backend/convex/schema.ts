import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";


export default defineSchema({
    users: defineTable({
        userId: v.string(),
        username: v.string(),
        email: v.string(),
        password: v.string(),
        avatar: v.optional(v.string()),
        name: v.optional(v.string()),
        isVerified: v.boolean(),
        role: v.union(v.literal("USER"), v.literal("ADMIN")),
        updatedAt: v.number(), // _createdAt exists by-default
        createdProblems: v.array(v.id("problems")),
        solvedProblems: v.array(v.id("problems")),
        createdContests: v.array(v.id("contests")),
        participatedContests: v.array(v.id("contests")),
    }).index("by_user_id", ["userId"]),

    problems: defineTable({
        problemId: v.string(),
        title: v.string(),
        description: v.string(),
        creatorId: v.id("users"),  // createdBy
        testcases: v.array(v.id("testcases")),
        contests: v.array(v.id("contests")),
        submissions: v.array(v.id("submissions")),
        updatedAt: v.number(), // _createdAt exists by-default

        // suggestions from anthropic.claude ----
        timeLimit: v.number(), // in seconds
        memoryLimit: v.number(), // in MB
        difficulty: v.optional(v.union(v.literal("EASY"), v.literal("MEDIUM"), v.literal("HARD"))),
        tags: v.optional(v.array(v.string())), // ["array", "sorting", "dp"]
        sampleInput: v.optional(v.string()),
        sampleOutput: v.optional(v.string()),
        // ----
    })
        .index("by_problem_id", ["problemId"])
        .index("by_creator_id", ["creatorId"]),

    // suggestions from anthropic.claude ----
    problemStats: defineTable({
        problemId: v.id("problems"),
        totalSubmissions: v.number(),
        acceptedSubmissions: v.number(),
        acceptanceRate: v.number(),
    }).index("by_problem_id", ["problemId"]),
    // ----

    testcases: defineTable({
        testcaseId: v.string(),
        input: v.string(),
        output: v.string(),
        isPublic: v.boolean(),
        problemId: v.id("problems")
    })
        .index("by_test_case_id", ["testcaseId"])
        .index("by_problem_id", ["problemId"]),

    contestProblems: defineTable({
        contestProblemId: v.string(),
        contestId: v.id("contests"),
        problemId: v.id("problems"),
        order: v.number(),
        points: v.number(),
    })
        .index("by_contest_problem_id", ["contestProblemId"])
        .index("by_contest_id", ["contestId"])
        .index("by_problem_id", ["problemId"]),

    contests: defineTable({
        contestId: v.string(),
        name: v.string(),
        description: v.string(),
        creatorId: v.id("users"),
        startTime: v.number(),
        endTime: v.number(),
        isPublic: v.boolean(),
        maxSize: v.number(),
        problems: v.array(v.id("contestProblems")),
        users: v.array(v.id("users")),
        updatedAt: v.number(),
    })
        .index("by_contest_id", ["contestId"])
        .index("by_creator_id", ["creatorId"]),

    submissions: defineTable({
        submissionId: v.string(),
        userId: v.id("users"),
        problemId: v.id("problems"),
        contestId: v.optional(v.id("contests")), // user can solve normal problems also without being in a contest
        user_code: v.string(),
        language: v.string(),
        status: v.union(v.literal("PENDING"), v.literal("RUNNING"), v.literal("DONE")),
        runtime: v.string(), // Check judge0 api guide to confirm... (language_id)
        memory: v.string(), // Check judge0 before coming to this part
        executions: v.array(v.id("judge0Executions")),

        // suggestions from anthropic.claude
        verdict: v.optional(v.union(
            v.literal("ACCEPTED"),
            v.literal("WRONG_ANSWER"), 
            v.literal("TIME_LIMIT_EXCEEDED"),
            v.literal("MEMORY_LIMIT_EXCEEDED"),
            v.literal("COMPILATION_ERROR"),
            v.literal("RUNTIME_ERROR"),
        )),
        score: v.optional(v.number()), // for partial scoring
        totalTestCases: v.optional(v.number()),
        passedTestCases: v.optional(v.number()),
        // ----
    })
        .index("by_submission_id", ["submissionId"])
        .index("by_user_id", ["userId"])
        .index("by_contest_id", ["contestId"])
        .index("by_problem_id", ["problemId"]),

    // suggestions from anthropic.claude
    contestSubmissions: defineTable({
        contestSubmissionId: v.string(),
        contestId: v.id("contests"),
        userId: v.id("users"),
        problemId: v.id("problems"),
        submissionId: v.id("submissions"),
        points: v.number(),
        penalty: v.number(), // for ACM-style contests
        submissionTime: v.number(),
    }).index("by_contest_id", ["contestId"]),
    // ----

    judge0Executions: defineTable({
        judge0ExecutionId: v.string(),
        token: v.string(),
        submissionId: v.id("submissions"),
        testcaseId: v.id("testcases"),
        stdout: v.optional(v.string()),
        stdin: v.optional(v.string()),
        status: v.union(v.literal("PENDING"), v.literal("RUNNING"), v.literal("DONE")),
        time: v.number(),
        memory: v.number(),

        // suggestions from anthropic.claude
        stderr: v.optional(v.string()), // compilation/runtime errors
        compile_output: v.optional(v.string()),
        verdict: v.optional(v.string()), // "Accepted", "Wrong Answer", etc.
        exit_code: v.optional(v.number()),
    })
        .index("by_judge0_execution_id", ["judge0ExecutionId"])
        .index("by_token", ["token"])
        .index("by_submission_id", ["submissionId"])
        .index("by_testcase_id", ["testcaseId"])
})