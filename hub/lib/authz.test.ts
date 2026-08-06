import { describe, it, expect } from "vitest";
import {
  canEdit,
  canMerge,
  canSetOwnerOrg,
  canManageUsers,
  canEditVocab,
  type Actor,
} from "./authz";

const spark: Actor = { id: 1, email: "spark@bu.edu", org: "spark", isSuper: false };
const cds: Actor = { id: 2, email: "cds@bu.edu", org: "cds", isSuper: false };
const superAdmin: Actor = { id: 3, email: "super@bu.edu", org: "spark", isSuper: true };
/** What a row looks like if someone bypasses the CHECK, or an actor is half-built. */
const untagged: Actor = { id: 4, email: "nobody@bu.edu", org: "", isSuper: false };

describe("canEdit", () => {
  it("lets a scoped admin edit their own org's projects", () => {
    expect(canEdit(spark, "spark")).toBe(true);
    expect(canEdit(cds, "cds")).toBe(true);
  });

  it("blocks a scoped admin from the other org's projects", () => {
    expect(canEdit(spark, "cds")).toBe(false);
    expect(canEdit(cds, "spark")).toBe(false);
  });

  // The single most important case. All 23 cds-tagged projects in the live DB are
  // ALSO spark-tagged, so it is very tempting for a future reader to conclude that
  // "has cds in surfaces" means "CDS may edit it". It does not: surfaces is
  // visibility, owner_org is authority. If this test ever fails, the two axes have
  // been collapsed back together.
  it("does NOT grant CDS access to a dual-surface project owned by Spark", () => {
    const dualSurfaceSparkOwned = { surfaces: ["cds", "spark"], ownerOrg: "spark" };
    expect(canEdit(cds, dualSurfaceSparkOwned.ownerOrg)).toBe(false);
    expect(canEdit(spark, dualSurfaceSparkOwned.ownerOrg)).toBe(true);
  });

  it("lets a super admin edit either org, and anything unrecognised", () => {
    expect(canEdit(superAdmin, "spark")).toBe(true);
    expect(canEdit(superAdmin, "cds")).toBe(true);
    expect(canEdit(superAdmin, "some-future-org")).toBe(true);
  });

  // Fail-closed: an actor with no usable org authorises nothing. The third case is
  // why canEdit guards on ORGS membership rather than trusting `===` alone.
  it("fails closed for an actor with an empty or unknown org", () => {
    expect(canEdit(untagged, "spark")).toBe(false);
    expect(canEdit(untagged, "cds")).toBe(false);
    expect(canEdit(untagged, "")).toBe(false);
    expect(canEdit({ ...untagged, org: "sparkk" }, "sparkk")).toBe(false);
  });
});

describe("canMerge", () => {
  it("allows a same-org merge", () => {
    expect(canMerge(spark, "spark", "spark")).toBe(true);
    expect(canMerge(cds, "cds", "cds")).toBe(true);
  });

  // Both orderings: checking only the survivor is the natural implementation bug,
  // and it would let a scoped admin absorb (and delete) the other org's project.
  it("blocks a cross-org merge from either direction", () => {
    expect(canMerge(spark, "spark", "cds")).toBe(false);
    expect(canMerge(spark, "cds", "spark")).toBe(false);
    expect(canMerge(cds, "spark", "cds")).toBe(false);
    expect(canMerge(cds, "cds", "spark")).toBe(false);
  });

  it("allows a super admin to merge across orgs", () => {
    expect(canMerge(superAdmin, "spark", "cds")).toBe(true);
    expect(canMerge(superAdmin, "cds", "spark")).toBe(true);
  });
});

describe("super-only capabilities", () => {
  it("are denied to both scoped orgs and granted to supers", () => {
    for (const fn of [canSetOwnerOrg, canManageUsers, canEditVocab]) {
      expect(fn(spark)).toBe(false);
      expect(fn(cds)).toBe(false);
      expect(fn(untagged)).toBe(false);
      expect(fn(superAdmin)).toBe(true);
    }
  });
});
