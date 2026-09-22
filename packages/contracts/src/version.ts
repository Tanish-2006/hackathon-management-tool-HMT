/**
 * Contract versioning convention:
 * - All events and API DTOs carry a `version` field for backward compatibility.
 * - Version format: "v1", "v2", ... major only for now; minor changes must be additive.
 * - Consumers MUST ignore unknown fields and check `version` before processing.
 * - Breaking changes require a new major version and dual publishing during migration window.
 */

export const CONTRACT_VERSION = 'v1' as const;
export type ContractVersion = typeof CONTRACT_VERSION;

export interface Versioned {
  version: ContractVersion;
}
