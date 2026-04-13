import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { Asset } from "../lib/api";
import { assetFormSchema, type AssetFormValues } from "../lib/forms";
import { t } from "../lib/i18n";

type AssetFormProps = {
  asset?: Asset;
  isSubmitting: boolean;
  errorMessage?: string | null;
  onSubmit: (values: AssetFormValues) => Promise<void> | void;
  onCancel: () => void;
};

type AssetFormFields = {
  symbol: string;
  name: string;
  currency: string;
  currentPrice: number;
};

export function AssetForm({
  asset,
  isSubmitting,
  errorMessage,
  onSubmit,
  onCancel,
}: AssetFormProps) {
  const form = useForm<AssetFormFields, undefined, AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      symbol: asset?.symbol ?? "",
      name: asset?.name ?? "",
      currency: asset?.currency ?? "USD",
      currentPrice: asset?.currentPrice ?? 0,
    },
  });

  useEffect(() => {
    form.reset({
      symbol: asset?.symbol ?? "",
      name: asset?.name ?? "",
      currency: asset?.currency ?? "USD",
      currentPrice: asset?.currentPrice ?? 0,
    });
  }, [asset, form]);

  return (
    <form className="form" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="form-grid">
        <label className="field">
          <span>{t.assets.form.symbol}</span>
          <input placeholder="AAPL" aria-label={t.assets.form.symbol} {...form.register("symbol")} />
          <small>{form.formState.errors.symbol?.message}</small>
        </label>

        <label className="field">
          <span>{t.assets.form.currency}</span>
          <input
            placeholder="USD"
            maxLength={3}
            aria-label={t.assets.form.currency}
            {...form.register("currency")}
          />
          <small>{form.formState.errors.currency?.message}</small>
        </label>

        <label className="field field--full">
          <span>{t.assets.form.name}</span>
          <input placeholder="Apple Inc." aria-label={t.assets.form.name} {...form.register("name")} />
          <small>{form.formState.errors.name?.message}</small>
        </label>

        <label className="field field--full">
          <span>{t.assets.form.currentPrice}</span>
          <input
            type="number"
            step="0.000001"
            min="0"
            aria-label={t.assets.form.currentPrice}
            {...form.register("currentPrice")}
          />
          <small>{form.formState.errors.currentPrice?.message}</small>
        </label>
      </div>

      {errorMessage ? <div className="form-message form-message--error">{errorMessage}</div> : null}

      <div className="form-actions">
        <button type="button" className="ghost-button" onClick={onCancel}>
          {t.common.cancel}
        </button>
        <button type="submit" className="primary-button" disabled={isSubmitting}>
          {isSubmitting ? t.common.saveInProgress : asset ? t.assets.form.update : t.assets.form.create}
        </button>
      </div>
    </form>
  );
}
