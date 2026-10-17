import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, ORDER_TRANSITIONS, type OrderStatusName } from "@asap/shared";
import { OrderTransitionError, assertTransition, canTransition, deriveOrderStatus, isRefundable, isTerminal } from "./state-machine";

describe("order state machine", () => {
  it("allows exactly the transitions of ORDER_TRANSITIONS", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        expect(canTransition(from, to)).toBe(ORDER_TRANSITIONS[from].includes(to));
      }
    }
  });

  it("happy path PENDING -> PAID -> PROCESSING -> DELIVERED -> DISPUTED -> DELIVERED -> REFUNDED", () => {
    const path: OrderStatusName[] = ["PENDING", "PAID", "PROCESSING", "DELIVERED", "DISPUTED", "DELIVERED", "REFUNDED"];
    for (let i = 0; i < path.length - 1; i++) expect(() => assertTransition(path[i]!, path[i + 1]!)).not.toThrow();
  });

  it("auto-delivery may skip PROCESSING", () => {
    expect(canTransition("PAID", "DELIVERED")).toBe(true);
  });

  it("rejects invalid jumps with OrderTransitionError", () => {
    expect(() => assertTransition("PENDING", "DELIVERED")).toThrow(OrderTransitionError);
    expect(() => assertTransition("DELIVERED", "PAID")).toThrow(/DELIVERED -> PAID/);
    expect(() => assertTransition("CANCELLED", "PAID")).toThrow(OrderTransitionError);
    expect(() => assertTransition("PAID", "CANCELLED")).toThrow(OrderTransitionError); // paid orders are refunded, not cancelled
  });

  it("terminal states have no exits", () => {
    expect(isTerminal("REFUNDED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("PAID")).toBe(false);
  });

  it("refundable statuses", () => {
    for (const s of ["PAID", "PROCESSING", "DELIVERED", "DISPUTED", "FAILED"] as const) expect(isRefundable(s)).toBe(true);
    for (const s of ["PENDING", "CANCELLED", "REFUNDED"] as const) expect(isRefundable(s)).toBe(false);
  });
});

describe("deriveOrderStatus", () => {
  it("all items delivered -> DELIVERED", () => {
    expect(deriveOrderStatus("PAID", ["DELIVERED", "DELIVERED"])).toBe("DELIVERED");
    expect(deriveOrderStatus("PROCESSING", ["DELIVERED"])).toBe("DELIVERED");
  });
  it("mix of delivered and processing -> PROCESSING (from PAID) / unchanged (already PROCESSING)", () => {
    expect(deriveOrderStatus("PAID", ["DELIVERED", "PROCESSING"])).toBe("PROCESSING");
    expect(deriveOrderStatus("PROCESSING", ["DELIVERED", "PROCESSING"])).toBeNull();
  });
  it("only pending items keep a PAID order as is", () => {
    expect(deriveOrderStatus("PAID", ["PENDING", "PENDING"])).toBeNull();
  });
  it("failed items with nothing in progress -> FAILED", () => {
    expect(deriveOrderStatus("PAID", ["FAILED"])).toBe("FAILED");
    expect(deriveOrderStatus("PROCESSING", ["DELIVERED", "FAILED"])).toBe("FAILED");
  });
  it("ignores refunded items when deriving", () => {
    expect(deriveOrderStatus("DELIVERED", ["REFUNDED", "REFUNDED"])).toBe("REFUNDED");
    expect(deriveOrderStatus("PAID", ["REFUNDED", "DELIVERED"])).toBe("DELIVERED");
  });
  it("never returns a transition the table forbids", () => {
    expect(deriveOrderStatus("REFUNDED", ["DELIVERED"])).toBeNull();
    expect(deriveOrderStatus("CANCELLED", ["DELIVERED"])).toBeNull();
  });
});
