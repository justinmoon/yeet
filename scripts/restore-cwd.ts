const originalCwd = process.env.YEET_ORIGINAL_PWD;

if (originalCwd) {
  try {
    process.chdir(originalCwd);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
    console.error(`Failed to restore cwd to ${originalCwd}: ${reason}`);
    process.exit(1);
  }
}
