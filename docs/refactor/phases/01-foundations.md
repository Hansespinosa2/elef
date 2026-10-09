# Phase 01 — Foundations, contracts, and final persistence location

**Goal:** establish the permanent seams needed by later behavior changes before those behavior changes occur.

## PLAN

Inventory the existing desktop Rust core and every shared-client operation. Freeze the move strategy so structural moves and behavior changes are separate commits.

## DO target

- root npm and Cargo workspaces established;
- `packages/contracts` created with the public types in the constitution and exact operation signatures derived from existing shared behavior;
- Rails and Tauri adapters pass the same contract conformance suite;
- fake in-memory host implements `ElefHost` and can mount the minimal shared client shell;
- existing Tauri-independent Rust persistence core is moved/reconciled directly into final `crates/local-store`; no later rehome phase is planned;
- architecture rules/checker encode dependency boundaries and package admission constraints;
- `bin/check quick/affected/phase/all` implemented with timing instrumentation;
- canonical generated artifacts use package `dist/` homes rather than synchronized committed host copies.

## Normative target interfaces

Phase 01 must implement these exact public semantics (formatting may differ):

```ts
type WorkKind = "document" | "presentation";
type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
type WorkId = string & { readonly __brand: "WorkId" };
type MediaId = string & { readonly __brand: "MediaId" };
type RequestId = string & { readonly __brand: "RequestId" };

type ElefErrorCategory = "not_found" | "conflict" | "permission_denied" | "invalid_input" | "invalid_document" | "invalid_archive" | "unsupported_version" | "storage_unavailable" | "cancelled" | "internal" | "unauthenticated" | "entitlement_required";
interface ElefError { category: ElefErrorCategory; message: string; retryable: boolean; }
interface HostCapabilities { accounts:boolean; collaboration:boolean; entitlements:boolean; updater:boolean; nativeMenus:boolean; localFilesystem:boolean; }
interface PersistenceBaseline { revision:string; }
interface WorkSummary { id:WorkId; workspaceId:WorkspaceId; title:string; kind:WorkKind; }
interface WorkSnapshot extends WorkSummary { text:string; baseline:PersistenceBaseline; }
type TextChange = { from:number; to:number; insert:string };
type SaveResult = {kind:"saved"; baseline:PersistenceBaseline} | {kind:"conflict"; current:WorkSnapshot};
type FlushResult = {kind:"clean"|"saved"; baseline:PersistenceBaseline} | {kind:"conflict"; current:WorkSnapshot} | {kind:"failed"; error:ElefError};
type SessionStatus = {kind:"clean"|"dirty"|"saving"} | {kind:"error"; error:ElefError};

interface WorkSession {
  readonly workId:WorkId; readonly kind:WorkKind;
  getText():string; applyLocalChange(change:TextChange):void; replaceText(text:string):void;
  onExternalChange(h:(snapshot:WorkSnapshot)=>void):()=>void;
  onStatus(h:(status:SessionStatus)=>void):()=>void;
  flush():Promise<FlushResult>; dispose():void;
}

interface LibraryPort { listWorkspaces():Promise<{id:WorkspaceId;name:string}[]>; listWorks(workspaceId:WorkspaceId):Promise<WorkSummary[]>; createWork(input:{workspaceId:WorkspaceId;title:string;kind:WorkKind;text?:string}):Promise<WorkSummary>; renameWork(workId:WorkId,title:string):Promise<WorkSummary>; deleteWork(workId:WorkId):Promise<void>; }
interface WorksPort { getWork(workId:WorkId):Promise<WorkSnapshot>; saveWork(workId:WorkId,text:string,baseline:PersistenceBaseline):Promise<SaveResult>; }
interface MediaPort { listMedia(workId:WorkId):Promise<{id:MediaId;workId:WorkId;name:string;mimeType:string}[]>; addMedia(workId:WorkId,input:{name:string;mimeType:string;bytes:Uint8Array}):Promise<{id:MediaId;workId:WorkId;name:string;mimeType:string}>; removeMedia(mediaId:MediaId):Promise<void>; resolveMedia(mediaId:MediaId):Promise<{id:MediaId;workId:WorkId;name:string;mimeType:string;url:string}>; }
type ProductSettings = Record<string,unknown>;
interface SettingsPort { getSettings():Promise<ProductSettings>; updateSettings(patch:Partial<ProductSettings>):Promise<ProductSettings>; }
interface SearchPort { search(input:{requestId:RequestId;query:string;workspaceId?:WorkspaceId}):Promise<{requestId:RequestId;hits:{work:WorkSummary;excerpt?:string}[]}>; }
interface TransferPort { importElef(bytes:Uint8Array,workspaceId:WorkspaceId):Promise<WorkSummary[]>; exportElef(workIds:WorkId[]):Promise<Uint8Array>; }
interface ElefHost { capabilities:HostCapabilities; library:LibraryPort; works:WorksPort; media:MediaPort; settings:SettingsPort; search:SearchPort; transfer:TransferPort; createWorkSession(workId:WorkId):Promise<WorkSession>; }
function mountElef(hostElement:HTMLElement, host:ElefHost, options?:{initialUrl?:string}):{unmount():void};
```

An additional operation may be added only with repository evidence that existing shared behavior requires it and matching Rails/Tauri/fake-host conformance tests.

## PASS criteria

- **P01-01** contract types and operation signatures compile under strict TS and are documented by code, not duplicated prose.
- **P01-02** Rails, Tauri and fake host pass one contract conformance suite for library, works, media, settings, search and transfer minimum behavior.
- **P01-03** `WorkSession` public interface exists exactly as the constitution defines and both current host policies can be adapted to it without client host-name branching.
- **P01-04** `crates/local-store` tests run headlessly with no Tauri dependency.
- **P01-05** architecture checker rejects a deliberate forbidden-import canary and any new boundary violation.
- **P01-06** after one recorded bootstrap/cache warm-up on the normal 8 GB Linux implementation container, `quick` ≤180 s and `affected` ≤420 s. First-run dependency download/clean compilation is measured separately. Failure requires test-selection/caching optimization before any budget exception is proposed.
- **P01-07** fake host mounts the client shell with no Rails/Tauri process.
- **P01-08** build freshness leaves no diff and there is one canonical pre-packaging artifact location per generated asset.
