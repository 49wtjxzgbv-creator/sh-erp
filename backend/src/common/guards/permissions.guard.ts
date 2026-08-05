// SUPERSEDED — kept only because this sandbox's mounted filesystem could
// not delete the file (see the workspace limitation disclosed elsewhere in
// this project's docs). Not imported or registered anywhere; delete this
// file for real once you have normal filesystem access.
//
// Permission checking now happens in TenantScopeInterceptor
// (../interceptors/tenant-scope.interceptor.ts), not a Guard — moved there
// because it also has to activate Postgres RLS per request, which requires
// wrapping `next.handle()`, something only an Interceptor can do (a Guard
// has no equivalent hook). See that file's header comment for the full
// explanation, and PrismaService's header comment for why RLS activation
// needed to move at all.
export {};
