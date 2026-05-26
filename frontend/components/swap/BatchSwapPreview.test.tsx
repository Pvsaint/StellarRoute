import { render, screen, fireEvent } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchSwapPreview, BatchSwapLeg } from "./BatchSwapPreview";

describe("BatchSwapPreview", () => {
  beforeEach(() => {
    // Clear feature flag overrides by default
    delete (window as any).__STELLAR_ROUTE_FLAGS__;
  });

  afterEach(() => {
    cleanup();
  });

  const mockLegs: BatchSwapLeg[] = [
    {
      id: "leg-1",
      fromAsset: "XLM",
      toAsset: "USDC",
      fromAmount: "100.00",
      toAmount: "10.50",
      price: "0.105000",
      priceImpact: "0.12",
    },
    {
      id: "leg-2",
      fromAsset: "USDC",
      toAsset: "XLM",
      fromAmount: "50.00",
      toAmount: "475.00",
      price: "9.500000",
      priceImpact: "0.85",
    },
  ];

  it("should show Lock/Beta screen when batchSwaps feature flag is disabled", () => {
    // Force feature flag to be false
    (window as any).__STELLAR_ROUTE_FLAGS__ = { batchSwaps: false };

    render(
      <BatchSwapPreview
        legs={mockLegs}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText("Batch Swap Beta")).toBeInTheDocument();
    expect(screen.getByText(/batchSwaps/)).toBeInTheDocument();
    expect(screen.queryByTestId("batch-swap-preview")).not.toBeInTheDocument();
  });

  it("should render preview layout when batchSwaps feature flag is enabled", () => {
    // Force feature flag to be true
    (window as any).__STELLAR_ROUTE_FLAGS__ = { batchSwaps: true };

    render(
      <BatchSwapPreview
        legs={mockLegs}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByTestId("batch-swap-preview")).toBeInTheDocument();
    expect(screen.getByText("Batch Swap Preview")).toBeInTheDocument();
    expect(screen.getByText("2 Legs")).toBeInTheDocument();
    expect(screen.queryByText("Batch Swap Beta")).not.toBeInTheDocument();
  });

  it("should render empty state when legs array is empty", () => {
    (window as any).__STELLAR_ROUTE_FLAGS__ = { batchSwaps: true };

    render(
      <BatchSwapPreview
        legs={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText("No Swap Legs Found")).toBeInTheDocument();
    expect(screen.getByText(/Your batch swap is currently empty/)).toBeInTheDocument();
  });

  it("should render loading skeletons when isLoading is true", () => {
    (window as any).__STELLAR_ROUTE_FLAGS__ = { batchSwaps: true };

    render(
      <BatchSwapPreview
        legs={mockLegs}
        isLoading={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByTestId("batch-swap-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("batch-swap-preview")).not.toBeInTheDocument();
  });

  it("should render error state when error is provided", () => {
    (window as any).__STELLAR_ROUTE_FLAGS__ = { batchSwaps: true };
    const mockRetry = vi.fn();

    render(
      <BatchSwapPreview
        legs={mockLegs}
        error="Simulation failed due to liquidity mismatch"
        onRetry={mockRetry}
      />
    );

    expect(screen.getByText("Simulation Failed")).toBeInTheDocument();
    expect(screen.getByText("Simulation failed due to liquidity mismatch")).toBeInTheDocument();
    
    const retryBtn = screen.getByRole("button", { name: /Retry Simulation/ });
    expect(retryBtn).toBeInTheDocument();
    
    fireEvent.click(retryBtn);
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it("should correctly group and sum subtotals", () => {
    (window as any).__STELLAR_ROUTE_FLAGS__ = { batchSwaps: true };

    render(
      <BatchSwapPreview
        legs={[
          {
            id: "l1",
            fromAsset: "XLM",
            toAsset: "USDC",
            fromAmount: "100.00",
            toAmount: "10.00",
          },
          {
            id: "l2",
            fromAsset: "XLM",
            toAsset: "USDC",
            fromAmount: "50.50",
            toAmount: "5.00",
          },
          {
            id: "l3",
            fromAsset: "USDC",
            toAsset: "BTC",
            fromAmount: "15.00",
            toAmount: "0.0002",
          },
        ]}
      />
    );

    const sentSection = screen.getByTestId("subtotals-sent");
    const receivedSection = screen.getByTestId("subtotals-received");

    // Sum XLM input: 100.00 + 50.50 = 150.50
    expect(sentSection).toHaveTextContent("150.50");
    // Sum USDC input: 15.00
    expect(sentSection).toHaveTextContent("15.00");

    // Sum USDC output: 10.00 + 5.00 = 15.00
    expect(receivedSection).toHaveTextContent("15.00");
    // Sum BTC output: 0.0002
    expect(receivedSection).toHaveTextContent("0.0002");
  });

  it("should fire confirm and cancel callbacks", () => {
    (window as any).__STELLAR_ROUTE_FLAGS__ = { batchSwaps: true };
    const mockConfirm = vi.fn();
    const mockCancel = vi.fn();

    render(
      <BatchSwapPreview
        legs={mockLegs}
        onConfirm={mockConfirm}
        onCancel={mockCancel}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: "Submit Batch Swap" });
    const cancelBtn = screen.getByRole("button", { name: "Clear Batch" });

    fireEvent.click(confirmBtn);
    expect(mockConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(cancelBtn);
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });
});
