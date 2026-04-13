import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createTransaction,
  deleteTransaction,
  getAssets,
  getErrorMessage,
  getTransactions,
  updateTransaction,
  type Transaction,
  type TransactionType,
} from "../lib/api";
import { formatCurrency, formatDateTime, formatNumber } from "../lib/format";
import type { TransactionFormValues } from "../lib/forms";
import { t } from "../lib/i18n";
import {
  applySortDirection,
  compareNumber,
  compareText,
  getUniqueOptions,
  matchesSearch,
  type SortDirection,
} from "../lib/table-utils";
import { Modal } from "../components/modal";
import { TableToolbar } from "../components/table-toolbar";
import { TransactionForm } from "../components/transaction-form";
import { useToast } from "../components/toast";

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; transaction: Transaction };

type TransactionSortKey = "symbol" | "occurredAt" | "value" | "fee";

export function TransactionsPage() {
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [formError, setFormError] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<TransactionType | "">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [sortBy, setSortBy] = useState<TransactionSortKey>("occurredAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const assetsQuery = useQuery({
    queryKey: ["assets"],
    queryFn: getAssets,
  });

  const transactionsQuery = useQuery({
    queryKey: ["transactions", assetFilter, typeFilter],
    queryFn: () =>
      getTransactions({
        assetId: assetFilter || undefined,
        type: typeFilter,
      }),
  });

  const createMutation = useMutation({
    mutationFn: createTransaction,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["holdings"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
      ]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<TransactionFormValues> }) =>
      updateTransaction(id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["holdings"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["holdings"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
      ]);
    },
  });

  async function handleSubmit(values: TransactionFormValues) {
    setFormError(null);

    try {
      if (editor.mode === "edit") {
        await updateMutation.mutateAsync({ id: editor.transaction.id, payload: values });
        notify({ tone: "success", title: t.transactions.updated });
      } else {
        await createMutation.mutateAsync(values);
        notify({ tone: "success", title: t.transactions.created });
      }

      setEditor({ mode: "closed" });
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  async function handleDelete(transaction: Transaction) {
    const confirmed = window.confirm(
      t.transactions.deleteConfirm(transaction.type, transaction.asset.symbol, formatDateTime(transaction.occurredAt)),
    );

    if (!confirmed) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(transaction.id);
      notify({ tone: "success", title: t.transactions.deleted });
    } catch (error) {
      notify({
        tone: "error",
        title: t.transactions.deleteFailed,
        description: getErrorMessage(error),
      });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const editingTransaction = editor.mode === "edit" ? editor.transaction : undefined;
  const assets = assetsQuery.data ?? [];
  const transactions = transactionsQuery.data ?? [];
  const currencyOptions = getUniqueOptions(transactions.map((transaction) => transaction.asset.currency));
  const filteredTransactions = [...transactions]
    .filter((transaction) =>
      matchesSearch(searchQuery, transaction.asset.symbol, transaction.asset.name, transaction.note),
    )
    .filter((transaction) => (currencyFilter ? transaction.asset.currency === currencyFilter : true))
    .sort((left, right) => {
      switch (sortBy) {
        case "symbol":
          return applySortDirection(compareText(left.asset.symbol, right.asset.symbol), sortDirection);
        case "value":
          return compareNumber(left.quantity * left.price, right.quantity * right.price, sortDirection);
        case "fee":
          return compareNumber(left.fee, right.fee, sortDirection);
        case "occurredAt":
        default:
          return applySortDirection(Date.parse(left.occurredAt) - Date.parse(right.occurredAt), sortDirection);
      }
    });

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <span className="panel__eyebrow">{t.transactions.eyebrow}</span>
          <h2>{t.transactions.title}</h2>
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setFormError(null);
              setEditor({ mode: "create" });
            }}
            disabled={assets.length === 0}
          >
            {t.transactions.add}
          </button>
        </div>
      </div>

      <div className="filters">
        <label className="field">
          <span>{t.transactions.assetFilter}</span>
          <select aria-label={t.transactions.assetFilter} value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
            <option value="">{t.transactions.allAssets}</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.symbol}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{t.transactions.typeFilter}</span>
          <select
            aria-label={t.transactions.typeFilter}
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as TransactionType | "")}
          >
            <option value="">{t.transactions.allTypes}</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </label>
      </div>

      {assets.length === 0 ? (
        <div className="empty-state">
          <h3>{t.transactions.emptyAssetsTitle}</h3>
          <p>{t.transactions.emptyAssetsDescription}</p>
        </div>
      ) : null}

      {transactionsQuery.isPending ? <div className="loading-card loading-card--wide" /> : null}

      {transactionsQuery.isError ? (
        <div className="empty-state empty-state--error">
          <h3>{t.transactions.loadingErrorTitle}</h3>
          <p>{getErrorMessage(transactionsQuery.error)}</p>
        </div>
      ) : null}

      {transactions.length === 0 && !transactionsQuery.isPending && !transactionsQuery.isError ? (
        <div className="empty-state">
          <h3>{t.transactions.emptyTitle}</h3>
          <p>{t.transactions.emptyDescription}</p>
        </div>
      ) : null}

      {transactions.length > 0 ? (
        <>
          <TableToolbar
            searchLabel={t.common.search}
            searchPlaceholder={t.transactions.searchPlaceholder}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            filters={[
              {
                label: t.common.currency,
                value: currencyFilter,
                onChange: setCurrencyFilter,
                options: [
                  { value: "", label: t.common.allCurrencies },
                  ...currencyOptions.map((currency) => ({ value: currency, label: currency })),
                ],
              },
            ]}
            sortLabel={t.common.sortBy}
            sortOptions={[
              { value: "symbol", label: t.transactions.sortSymbol },
              { value: "occurredAt", label: t.transactions.sortDate },
              { value: "value", label: t.transactions.sortValue },
              { value: "fee", label: t.transactions.sortFee },
            ]}
            sortValue={sortBy}
            onSortChange={(value) => setSortBy(value as TransactionSortKey)}
            directionLabel={t.common.sortDirection}
            directionValue={sortDirection}
            directionOptions={[
              { value: "asc", label: t.common.sortAscending },
              { value: "desc", label: t.common.sortDescending },
            ]}
            onDirectionChange={(value) => setSortDirection(value as SortDirection)}
          />

          {filteredTransactions.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t.transactions.tableAsset}</th>
                    <th>{t.transactions.tableType}</th>
                    <th>{t.transactions.tableQuantity}</th>
                    <th>{t.transactions.tablePrice}</th>
                    <th>{t.transactions.tableFee}</th>
                    <th>{t.transactions.tableOccurredAt}</th>
                    <th>{t.transactions.tableNote}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>
                        <div className="primary-cell">
                          <strong>{transaction.asset.symbol}</strong>
                          <span>{transaction.asset.name}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${transaction.type === "BUY" ? "badge--buy" : "badge--sell"}`}>
                          {transaction.type}
                        </span>
                      </td>
                      <td>{formatNumber(transaction.quantity)}</td>
                      <td>{formatCurrency(transaction.price, transaction.asset.currency)}</td>
                      <td>{formatCurrency(transaction.fee, transaction.asset.currency)}</td>
                      <td>{formatDateTime(transaction.occurredAt)}</td>
                      <td>{transaction.note ?? "-"}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setFormError(null);
                              setEditor({ mode: "edit", transaction });
                            }}
                          >
                            {t.transactions.edit}
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleDelete(transaction)}
                            disabled={deleteMutation.isPending}
                          >
                            {t.transactions.delete}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h3>{t.common.emptyFilterTitle}</h3>
              <p>{t.common.emptyFilterDescription}</p>
            </div>
          )}
        </>
      ) : null}

      {editor.mode !== "closed" ? (
        <Modal
          title={editor.mode === "edit" ? t.transactions.modalEditTitle : t.transactions.modalCreateTitle}
          description={t.transactions.modalDescription}
          onClose={() => setEditor({ mode: "closed" })}
        >
          <TransactionForm
            assets={assets}
            transaction={editingTransaction}
            isSubmitting={isSaving}
            errorMessage={formError}
            onSubmit={handleSubmit}
            onCancel={() => setEditor({ mode: "closed" })}
          />
        </Modal>
      ) : null}
    </section>
  );
}
