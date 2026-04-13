import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TransactionForm } from "./transaction-form";
import { renderWithProviders } from "../test/render";

describe("TransactionForm", () => {
  it("submits normalized values", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();

    renderWithProviders(
      <TransactionForm
        assets={[
          {
            id: "asset-1",
            symbol: "BTC",
            name: "Bitcoin",
            currency: "USD",
            assetClass: "CRYPTO",
            portfolioEligible: false,
            currentPrice: 45000,
            createdAt: "",
            updatedAt: "",
          },
        ]}
        isSubmitting={false}
        onSubmit={handleSubmit}
        onCancel={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText("Množství"));
    await user.type(screen.getByLabelText("Množství"), "2");
    await user.clear(screen.getByLabelText("Cena"));
    await user.type(screen.getByLabelText("Cena"), "41000");
    await user.clear(screen.getByLabelText("Datum a čas"));
    await user.type(screen.getByLabelText("Datum a čas"), "2025-01-10T10:00");

    await user.click(screen.getByRole("button", { name: "Vytvořit transakci" }));

    await waitFor(() => {
      expect(handleSubmit.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          assetId: "asset-1",
          type: "BUY",
          quantity: 2,
          price: 41000,
          fee: 0,
        }),
      );
    });
  });
});
