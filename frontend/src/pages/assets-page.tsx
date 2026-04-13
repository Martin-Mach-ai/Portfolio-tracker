import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createAsset,
  deleteAsset,
  getAssets,
  getErrorMessage,
  updateAsset,
  type Asset,
} from "../lib/api";
import { formatOptionalCurrency } from "../lib/format";
import type { AssetFormValues } from "../lib/forms";
import { t } from "../lib/i18n";
import {
  applySortDirection,
  compareNumber,
  compareText,
  getUniqueOptions,
  matchesSearch,
  type SortDirection,
} from "../lib/table-utils";
import { AssetForm } from "../components/asset-form";
import { Modal } from "../components/modal";
import { TableToolbar } from "../components/table-toolbar";
import { useToast } from "../components/toast";

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; asset: Asset };

type AssetSortKey = "symbol" | "name" | "currentPrice" | "updatedAt";

export function AssetsPage() {
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [formError, setFormError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [assetClassFilter, setAssetClassFilter] = useState("");
  const [sortBy, setSortBy] = useState<AssetSortKey>("symbol");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const assetsQuery = useQuery({
    queryKey: ["assets"],
    queryFn: getAssets,
  });
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const createMutation = useMutation({
    mutationFn: createAsset,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assets"] }),
        queryClient.invalidateQueries({ queryKey: ["holdings"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
      ]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<AssetFormValues> }) =>
      updateAsset(id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assets"] }),
        queryClient.invalidateQueries({ queryKey: ["holdings"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAsset,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assets"] }),
        queryClient.invalidateQueries({ queryKey: ["holdings"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      ]);
    },
  });

  async function handleSubmit(values: AssetFormValues) {
    setFormError(null);

    try {
      if (editor.mode === "edit") {
        await updateMutation.mutateAsync({ id: editor.asset.id, payload: values });
        notify({ tone: "success", title: t.assets.updated, description: t.assets.updateDescription(values.symbol) });
      } else {
        await createMutation.mutateAsync(values);
        notify({ tone: "success", title: t.assets.created, description: t.assets.createDescription(values.symbol) });
      }

      setEditor({ mode: "closed" });
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  async function handleDelete(asset: Asset) {
    const confirmed = window.confirm(t.assets.deleteConfirm(asset.symbol));

    if (!confirmed) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(asset.id);
      notify({ tone: "success", title: t.assets.deleted, description: t.assets.deleteDescription(asset.symbol) });
    } catch (error) {
      notify({
        tone: "error",
        title: t.assets.deleteFailed,
        description: getErrorMessage(error),
      });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const editingAsset = editor.mode === "edit" ? editor.asset : undefined;
  const assets = assetsQuery.data ?? [];
  const currencyOptions = getUniqueOptions(assets.map((asset) => asset.currency));
  const assetClassOptions = getUniqueOptions(assets.map((asset) => asset.assetClass));
  const filteredAssets = [...assets]
    .filter((asset) => matchesSearch(searchQuery, asset.symbol, asset.name))
    .filter((asset) => (currencyFilter ? asset.currency === currencyFilter : true))
    .filter((asset) => (assetClassFilter ? asset.assetClass === assetClassFilter : true))
    .sort((left, right) => {
      switch (sortBy) {
        case "name":
          return applySortDirection(compareText(left.name, right.name), sortDirection);
        case "currentPrice":
          return compareNumber(left.currentPrice, right.currentPrice, sortDirection);
        case "updatedAt":
          return applySortDirection(Date.parse(left.updatedAt) - Date.parse(right.updatedAt), sortDirection);
        case "symbol":
        default:
          return applySortDirection(compareText(left.symbol, right.symbol), sortDirection);
      }
    });

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <span className="panel__eyebrow">{t.assets.eyebrow}</span>
          <h2>{t.assets.title}</h2>
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setFormError(null);
              setEditor({ mode: "create" });
            }}
          >
            {t.assets.addAsset}
          </button>
        </div>
      </div>

      {assetsQuery.isPending ? <div className="loading-card loading-card--wide" /> : null}

      {assetsQuery.isError ? (
        <div className="empty-state empty-state--error">
          <h3>{t.assets.loadingErrorTitle}</h3>
          <p>{getErrorMessage(assetsQuery.error)}</p>
        </div>
      ) : null}

      {assets.length === 0 ? (
        <div className="empty-state">
          <h3>{t.assets.emptyTitle}</h3>
          <p>{t.assets.emptyDescription}</p>
        </div>
      ) : null}

      {assets.length > 0 ? (
        <>
          <TableToolbar
            searchLabel={t.common.search}
            searchPlaceholder={t.assets.searchPlaceholder}
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
              {
                label: t.common.assetClass,
                value: assetClassFilter,
                onChange: setAssetClassFilter,
                options: [
                  { value: "", label: t.common.allAssetClasses },
                  ...assetClassOptions.map((assetClass) => ({
                    value: assetClass,
                    label: t.common.assetClassLabels[assetClass as keyof typeof t.common.assetClassLabels],
                  })),
                ],
              },
            ]}
            sortLabel={t.common.sortBy}
            sortOptions={[
              { value: "symbol", label: t.assets.sortSymbol },
              { value: "name", label: t.assets.sortName },
              { value: "currentPrice", label: t.assets.sortPrice },
              { value: "updatedAt", label: t.assets.sortUpdated },
            ]}
            sortValue={sortBy}
            onSortChange={(value) => setSortBy(value as AssetSortKey)}
            directionLabel={t.common.sortDirection}
            directionValue={sortDirection}
            directionOptions={[
              { value: "asc", label: t.common.sortAscending },
              { value: "desc", label: t.common.sortDescending },
            ]}
            onDirectionChange={(value) => setSortDirection(value as SortDirection)}
          />

          {filteredAssets.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t.assets.tableSymbol}</th>
                    <th>{t.assets.tableName}</th>
                    <th>{t.assets.tableAssetClass}</th>
                    <th>{t.assets.tableCurrency}</th>
                    <th>{t.assets.tableCurrentPrice}</th>
                    <th>{t.assets.tableUpdated}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td>{asset.symbol}</td>
                      <td>{asset.name}</td>
                      <td>{t.common.assetClassLabels[asset.assetClass]}</td>
                      <td>{asset.currency}</td>
                      <td>{formatOptionalCurrency(asset.currentPrice, asset.currency, t.common.priceUnavailable)}</td>
                      <td>{new Date(asset.updatedAt).toLocaleString()}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setFormError(null);
                              setEditor({ mode: "edit", asset });
                            }}
                          >
                            {t.assets.edit}
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleDelete(asset)}
                            disabled={deleteMutation.isPending}
                          >
                            {t.assets.delete}
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
          title={editor.mode === "edit" ? t.assets.modalEditTitle(editor.asset.symbol) : t.assets.modalCreateTitle}
          description={t.assets.modalDescription}
          onClose={() => setEditor({ mode: "closed" })}
        >
          <AssetForm
            asset={editingAsset}
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
