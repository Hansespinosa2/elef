export type ElefErrorCategory =
  | "not_found"
  | "conflict"
  | "permission_denied"
  | "invalid_input"
  | "invalid_document"
  | "invalid_archive"
  | "unsupported_version"
  | "storage_unavailable"
  | "cancelled"
  | "internal"
  | "unauthenticated"
  | "entitlement_required";

export interface ElefError {
  category: ElefErrorCategory;
  message: string;
  retryable: boolean;
}

export interface HostCapabilities {
  accounts: boolean;
  collaboration: boolean;
  entitlements: boolean;
  updater: boolean;
  nativeMenus: boolean;
  localFilesystem: boolean;
}
