import type { GitHubFetch } from "../../src/lib/github";

export const SHA = "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d";
export const githubFixture: GitHubFetch = async (input) => {
  const url = String(input);
  if (/\/commits\//.test(url)) return new Response(SHA);
  return Response.json({
    id: 1296269,
    private: false,
    visibility: "public",
    full_name: "octocat/Hello-World",
    owner: { login: "octocat" },
    default_branch: "master",
  });
};

export const submissionFixture = {
  name: "Test project",
  teamName: "Test team",
  repositoryUrl: "https://github.com/octocat/Hello-World.git",
  repositoryOwner: "octocat",
  ref: "master",
  claims: ["The team says the project provides a Hello World README."],
  ownershipAttested: true,
};
