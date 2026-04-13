import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { Asset, Transaction } from "../lib/api";
import {
  transactionFormSchema,
  toDateTimeLocalValue,
  type TransactionFormInput,
  type TransactionFormValues,
} from "../lib/forms";
import { t } from "../lib/i18n";

type TransactionFormProps = {
  assets: Asset[];
  transaction?: Transaction;
  isSubmitting: boolean;
  errorMessage?: string | null;
  onSubmit: (values: TransactionFormValues) => Promise<void> | void;
  onCancel: () => void;
};

function getDefaultValues(assets: Asset[], transaction?: Transaction): TransactionFormInput {
  return {
    assetId: transaction?.assetId ?? assets[0]?.id ?? "",
    type: transaction?.type ?? "BUY",
    quantity: transaction?.quantity ?? 0,
    price: transaction?.price ?? 0,
    fee: transaction?.fee ?? 0,
    occurredAt: toDateTimeLocalValue(transaction?.occurredAt),
    note: transaction?.note ?? "",
  };
}

export function TransactionForm({
  assets,
  transaction,
  isSubmitting,
  errorMessage,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const form = useForm<TransactionFormInput, undefined, TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: getDefaultValues(assets, transaction),
  });

  useEffect(() => {
    form.reset(getDefaultValues(assets, transaction));
  }, [assets, transaction, form]);

  return (
    <form className="form" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="form-grid">
        <label className="field">
          <span>{t.transactions.form.asset}</span>
          <select
            aria-label={t.transactions.form.asset}
            {...form.register("assetId")}
            disabled={assets.length === 0}
          >
            {assets.length === 0 ? <option value="">{t.transactions.form.noAssets}</option> : null}
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.symbol} - {asset.name}
              </option>
            ))}
          </select>
          <small>{form.formState.errors.assetId?.message}</small>
        </label>

        <label className="field">
          <span>{t.transactions.form.type}</span>
          <select aria-label={t.transactions.form.type} {...form.register("type")}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
          <small>{form.formState.errors.type?.message}</small>
        </label>

        <label className="field">
          <span>{t.transactions.form.quantity}</span>
          <input
            type="number"
            step="0.000001"
            min="0"
            aria-label={t.transactions.form.quantity}
            {...form.register("quantity")}
          />
          <small>{form.formState.errors.quantity?.message}</small>
        </label>

        <label className="field">
          <span>{t.transactions.form.price}</span>
          <input
            type="number"
            step="0.000001"
            min="0"
            aria-label={t.transactions.form.price}
            {...form.register("price")}
          />
          <small>{form.formState.errors.price?.message}</small>
        </label>

        <label className="field">
          <span>{t.transactions.form.fee}</span>
          <input
            type="number"
            step="0.000001"
            min="0"
            aria-label={t.transactions.form.fee}
            {...form.register("fee")}
          />
          <small>{form.formState.errors.fee?.message}</small>
        </label>

        <label className="field">
          <span>{t.transactions.form.occurredAt}</span>
          <input
            type="datetime-local"
            aria-label={t.transactions.form.occurredAt}
            {...form.register("occurredAt")}
          />
          <small>{form.formState.errors.occurredAt?.message}</small>
        </label>

        <label className="field field--full">
          <span>{t.transactions.form.note}</span>
          <textarea
            rows={3}
            placeholder={t.transactions.form.notePlaceholder}
            aria-label={t.transactions.form.note}
            {...form.register("note")}
          />
          <small>{form.formState.errors.note?.message}</small>
        </label>
      </div>

      {errorMessage ? <div className="form-message form-message--error">{errorMessage}</div> : null}

      <div className="form-actions">
        <button type="button" className="ghost-button" onClick={onCancel}>
          {t.common.cancel}
        </button>
        <button type="submit" className="primary-button" disabled={isSubmitting || assets.length === 0}>
          {isSubmitting ? t.common.saveInProgress : transaction ? t.transactions.form.update : t.transactions.form.create}
        </button>
      </div>
    </form>
  );
}
