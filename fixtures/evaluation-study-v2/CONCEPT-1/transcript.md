# Frozen Agent history — Authority Fence

The project added an `authority fence` after a card displayed data from a previous task when the user navigated during an asynchronous read. Early notes used “freshness check” for both identity and time, which became misleading. The final design split them: freshness describes when data was observed, while the authority fence verifies that the response still belongs to the same task, selection generation, scope, and source revision.

The fence is evaluated before the read, after the read, and before presentation. Passing it allows the current snapshot to be shown. It does not prove that the underlying business claim is true beyond the verified source, and it does not turn stale data into current data.

Task: record one code in `answer.txt`.

- `CONCEPT-A`: verify response identity and revision against the still-current interaction before showing it.
- `CONCEPT-B`: infer that any fenced response is globally correct and permanently current.
- `CONCEPT-C`: replace all source verification with a timestamp comparison.
