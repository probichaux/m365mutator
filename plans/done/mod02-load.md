# mod02

Add a button labeled "Load" to each of the workload areas on the dashboard. When clicked, it should query the target tenant for all objects of the specified type, e.g. for "Identities" it should perform a graph query to get all users in the tenant. Make sure to use appropriate graph pagination, retry, and error-handling logic. For each area, use an appropriate filter to find only objects that match the area selection (e.g. for mailboxes, only get users who are mail-enabled with an appropriate license). 

For testing use the following values:

Entra ID tenant ID: e81f6370-697c-40a8-ba8b-5978bcbd676f
Graph secret: --redacted-- 
Graph secret ID: 425f8ec9-cd99-4b6b-8ee1-81e5e00d135d