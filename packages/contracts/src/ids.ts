export type WorkKind = "document" | "presentation";
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type WorkId = string & { readonly __brand: "WorkId" };
export type MediaId = string & { readonly __brand: "MediaId" };
export type RequestId = string & { readonly __brand: "RequestId" };
