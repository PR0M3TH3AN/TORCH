#!/bin/bash
echo "Starting reproduction of npm test timeout..."

# Run npm test with a timeout to simulate the hang/slow behavior.
# The actual issue is a 400s timeout, but we demonstrate it by showing it doesn't complete quickly.
timeout 30s npm test > npm_test_output.log 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 124 ]; then
  echo "Reproduced: npm test timed out after 30s (demonstration)."
  echo "See npm_test_output.log for partial output."
elif [ $EXIT_CODE -ne 0 ]; then
  echo "npm test failed with exit code $EXIT_CODE"
  echo "See npm_test_output.log for output."
else
  echo "npm test passed (unexpected for reproduction, or it was very fast)"
fi
