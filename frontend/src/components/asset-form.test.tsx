import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AssetForm } from "./asset-form";
import { renderWithProviders } from "../test/render";

describe("AssetForm", () => {
  it("validates required fields", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();

    renderWithProviders(
      <AssetForm isSubmitting={false} onSubmit={handleSubmit} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Vytvořit aktivum" }));

    expect(await screen.findByText("Symbol is required")).toBeInTheDocument();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
