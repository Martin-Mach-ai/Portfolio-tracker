import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  commitImport,
  getErrorMessage,
  previewImport,
  type Broker,
  type ImportPreview,
  type ImportPreviewItem,
  type XtbImportPreviewItem,
} from "../lib/api";
import { formatCurrency, formatDateTime, formatNumber } from "../lib/format";
import { useToast } from "../components/toast";
import { t } from "../lib/i18n";

type BrokerSelection = "AUTO" | Broker;

const brokerOptions: Array<{ value: BrokerSelection; label: string }> = [
  { value: "AUTO", label: "Automatick\u00e1 detekce" },
  { value: "XTB", label: "XTB" },
  { value: "TRADING212", label: "Trading212" },
];

const brokerCopy: Record<BrokerSelection, { title: string; description: string; acceptHint: string }> = {
  AUTO: {
    title: t.import.title,
    description:
      "Nahraj CSV nebo XLSX report. Backend rozpozn\u00e1 XTB nebo Trading212 a p\u0159ed importem uk\u00e1\u017ee normalizovan\u00fd ledger.",
    acceptHint: "Podporovan\u00e9 form\u00e1ty: .csv a .xlsx.",
  },
  XTB: {
    title: t.import.pageTitleXtb,
    description: "Nahraj XTB report a zkontroluj normalizovan\u00e9 XTB ledger \u0159\u00e1dky p\u0159ed importem.",
    acceptHint: "Ide\u00e1ln\u00ed je XTB Excel export. CSV funguje, pokud sed\u00ed sloupce.",
  },
  TRADING212: {
    title: t.import.pageTitleTrading212,
    description:
      "Nahraj Trading212 export historie a zkontroluj normalizovan\u00e9 BUY/SELL \u0159\u00e1dky p\u0159ed importem.",
    acceptHint: "Importuj\u00ed se jen obchodn\u00ed \u0159\u00e1dky mapovan\u00e9 na BUY/SELL.",
  },
};

function isXtbItem(item: ImportPreviewItem): item is XtbImportPreviewItem {
  return item.broker === "XTB";
}

function renderValue(value: string | number | null | undefined): string | number {
  return value ?? "-";
}

function renderPortfolioBadge(portfolioEligible: boolean) {
  return portfolioEligible ? "ZA\u0158AZENO" : "MIMO";
}

export function ImportPage() {
  const [selectedBroker, setSelectedBroker] = useState<BrokerSelection>("AUTO");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const content = brokerCopy[selectedBroker];

  const previewMutation = useMutation({
    mutationFn: ({ file, broker }: { file: File; broker?: Broker }) => previewImport(file, broker),
    onSuccess: (data) => {
      setPreview(data);
      setErrorMessage(null);
    },
  });

  const commitMutation = useMutation({
    mutationFn: commitImport,
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assets"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["holdings"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
      ]);

      notify({
        tone: "success",
        title: `${data.broker} import dokon\u010den`,
        description: `${data.importedItemCount} \u0159\u00e1dk\u016f importov\u00e1no, vytvo\u0159eno ${data.transactionCount} ledger transakc\u00ed${data.excludedItemCount ? `, ${data.excludedItemCount} mimo portfolio` : ""}.`,
      });
      setPreview(null);
      setFile(null);
      setErrorMessage(null);
    },
  });

  async function handlePreview() {
    if (!file) {
      setErrorMessage("Nejd\u0159\u00edv vyber report brokera.");
      return;
    }

    try {
      await previewMutation.mutateAsync({
        file,
        broker: selectedBroker === "AUTO" ? undefined : selectedBroker,
      });
    } catch (error) {
      setPreview(null);
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleCommit() {
    if (!preview) {
      return;
    }

    try {
      await commitMutation.mutateAsync({
        broker: preview.broker,
        items: preview.items.filter((item) => item.status === "ready"),
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  const hasReadyRows = Boolean(preview && preview.summary.readyCount > 0);
  const issueItems = preview?.items.filter((item) => item.issues.length > 0) ?? [];
  const xtbItems = preview?.items.filter(isXtbItem) ?? [];
  const eligibleOpenXtbItems = xtbItems.filter(
    (item) => item.source === "POSITION_TABLE" && item.positionState === "OPEN" && item.portfolioEligible,
  );
  const noReadyReason =
    preview && !hasReadyRows
      ? `Import nejde dokon\u010dit, proto\u017ee n\u00e1hled obsahuje 0 p\u0159ipraven\u00fdch \u0159\u00e1dk\u016f. N\u00ed\u017ee zkontroluj ${preview.summary.duplicateCount} duplicit a ${preview.summary.invalidCount} nevalidn\u00edch \u0159\u00e1dk\u016f.`
      : null;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <span className="panel__eyebrow">{t.import.eyebrow}</span>
            <h2>{content.title}</h2>
          </div>
          <p className="panel__copy">{content.description}</p>
        </div>

        <div className="import-card">
          <label className="field">
            <span>{t.import.broker}</span>
            <select
              value={selectedBroker}
              onChange={(event) => {
                setSelectedBroker(event.target.value as BrokerSelection);
                setPreview(null);
                setErrorMessage(null);
              }}
            >
              {brokerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="upload-field">
            <span>{t.import.selectReport}</span>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                setPreview(null);
                setErrorMessage(null);
              }}
            />
          </label>
          <div className="import-card__meta">
            <strong>{file ? file.name : "Nen\u00ed vybran\u00fd \u017e\u00e1dn\u00fd soubor"}</strong>
            <span>{content.acceptHint}</span>
            {preview ? <span>Rozpoznan\u00fd broker: {preview.broker}</span> : null}
          </div>
          <div className="form-actions form-actions--start">
            <button
              type="button"
              className="primary-button"
              onClick={handlePreview}
              disabled={previewMutation.isPending}
            >
              {previewMutation.isPending ? t.import.parsing : t.import.preview}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={handleCommit}
              disabled={!preview || !hasReadyRows || commitMutation.isPending}
            >
              {commitMutation.isPending ? t.import.importing : t.import.confirm}
            </button>
          </div>
          {errorMessage ? <div className="form-message form-message--error">{errorMessage}</div> : null}
          {noReadyReason ? <div className="form-message form-message--warning">{noReadyReason}</div> : null}
        </div>
      </section>

      {preview ? (
        <>
          <section className="panel">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">N\u00e1hled</span>
                <h2>{preview.fileName}</h2>
              </div>
              <p className="panel__copy">Rozpoznan\u00fd broker: {preview.broker}</p>
            </div>

            <div className="summary-grid">
              <article className="summary-card">
                <span>Zdrojov\u00e9 \u0159\u00e1dky</span>
                <strong>{preview.summary.itemCount}</strong>
              </article>
              <article className="summary-card summary-card--positive">
                <span>P\u0159ipraveno k importu</span>
                <strong>{preview.summary.readyCount}</strong>
              </article>
              <article className="summary-card summary-card--positive">
                <span>Za\u0159azeno do portfolia</span>
                <strong>{preview.summary.includedCount ?? 0}</strong>
              </article>
              <article className="summary-card">
                <span>Mimo portfolio</span>
                <strong>{preview.summary.excludedCount ?? 0}</strong>
              </article>
              <article className="summary-card">
                <span>Duplicity</span>
                <strong>{preview.summary.duplicateCount}</strong>
              </article>
              <article className="summary-card summary-card--negative">
                <span>Nevalidn\u00ed</span>
                <strong>{preview.summary.invalidCount}</strong>
              </article>
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">\u0158\u00e1dky</span>
                <h2>{preview.broker === "XTB" ? "Na\u010dten\u00e9 XTB \u0159\u00e1dky" : "Na\u010dten\u00e9 \u0159\u00e1dky"}</h2>
              </div>
              <p className="panel__copy">
                {preview.broker === "XTB"
                  ? "Ka\u017ed\u00fd na\u010dten\u00fd XTB \u0159\u00e1dek je uveden\u00fd v\u010detn\u011b cash operac\u00ed a explicitn\u00edch otev\u0159en\u00fdch pozic."
                  : "Ka\u017ed\u00fd na\u010dten\u00fd \u0159\u00e1dek je zde uveden\u00fd se stavem importu."}
              </p>
            </div>

            {preview.items.length === 0 ? (
              <div className="empty-state">
                <h3>\u017d\u00e1dn\u00e9 na\u010dten\u00e9 \u0159\u00e1dky</h3>
                <p>Nahran\u00fd report nevytvo\u0159il \u017e\u00e1dn\u00e9 polo\u017eky n\u00e1hledu.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>\u0158\u00e1dek</th>
                      <th>Broker</th>
                      <th>{preview.broker === "XTB" ? "ID pozice" : "Extern\u00ed ID"}</th>
                      <th>Symbol</th>
                      {preview.broker === "XTB" ? (
                        <>
                          <th>Stav</th>
                          <th>Sm\u011br</th>
                          <th>Mno\u017estv\u00ed</th>
                          <th>Otev\u0159eno</th>
                          <th>Uzav\u0159eno</th>
                        </>
                      ) : null}
                      <th>Portfolio</th>
                      <th>Status</th>
                      <th>Probl\u00e9my</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item) => (
                      <tr key={`${item.broker}-${item.sourceRow}-${item.externalId ?? item.symbol}`}>
                        <td>{item.sourceRow}</td>
                        <td>{item.broker}</td>
                        <td>{renderValue(item.externalId)}</td>
                        <td>{item.symbol}</td>
                        {"positionState" in item ? (
                          <>
                            <td>
                              <span
                                className={`badge ${item.positionState === "OPEN" ? "badge--buy" : "badge--duplicate"}`}
                              >
                                {item.positionState}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${item.direction === "BUY" ? "badge--buy" : "badge--sell"}`}>
                                {item.direction}
                              </span>
                            </td>
                            <td>{formatNumber(item.volume)}</td>
                            <td>{formatDateTime(item.openTime)}</td>
                            <td>{item.closeTime ? formatDateTime(item.closeTime) : "-"}</td>
                          </>
                        ) : null}
                        <td>
                          {"portfolioEligible" in item ? (
                            <span className={`badge ${item.portfolioEligible ? "badge--buy" : "badge--duplicate"}`}>
                              {renderPortfolioBadge(item.portfolioEligible)}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          <span className={`badge badge--${item.status}`}>{item.status.toUpperCase()}</span>
                        </td>
                        <td>
                          {item.issues.length > 0 ? (
                            <div className="issue-list">
                              {item.issues.map((issue, index) => (
                                <span key={`${issue.code}-${index}`}>{issue.message}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="issue-list">Bez probl\u00e9m\u016f</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {preview.broker === "XTB" ? (
            <section className="panel">
              <div className="panel__header">
                <div>
                  <span className="panel__eyebrow">Aktu\u00e1ln\u00ed stav</span>
                  <h2>Pozice, kter\u00e9 aktu\u00e1ln\u011b dr\u017e\u00ed\u0161</h2>
                </div>
                <p className="panel__copy">
                  Otev\u0159en\u00e9 XTB pozice vhodn\u00e9 pro portfolio tracking. Tyto \u0159\u00e1dky se po importu prom\u00edtnou do aktu\u00e1ln\u00edch holdings.
                </p>
              </div>

              {eligibleOpenXtbItems.length === 0 ? (
                <div className="empty-state">
                  <h3>\u017d\u00e1dn\u00e9 vhodn\u00e9 otev\u0159en\u00e9 pozice</h3>
                  <p>Tento n\u00e1hled neobsahuje explicitn\u00ed \u0159\u00e1dky otev\u0159en\u00fdch pozic. Holdings p\u0159esto mohou vzniknout z importovan\u00fdch cash-operac\u00ed BUY a SELL.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Mno\u017estv\u00ed</th>
                        <th>Otev\u00edrac\u00ed cena</th>
                        <th>M\u011bna</th>
                        <th>Otev\u0159eno</th>
                        <th>Stav</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibleOpenXtbItems.map((item) => (
                        <tr key={`holding-${item.externalId}`}>
                          <td>{item.symbol}</td>
                          <td>{formatNumber(item.volume)}</td>
                          <td>{formatCurrency(item.openPrice, item.currency)}</td>
                          <td>{item.currency}</td>
                          <td>{formatDateTime(item.openTime)}</td>
                          <td>
                            <span className={`badge badge--${item.status}`}>{item.status.toUpperCase()}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          <section className="panel">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Probl\u00e9my</span>
                <h2>\u0158\u00e1dky, kter\u00e9 pot\u0159ebuj\u00ed kontrolu</h2>
              </div>
              <p className="panel__copy">{preview.summary.transactionCount} normalizovan\u00fdch transakc\u00ed bylo vytvo\u0159eno.</p>
            </div>

            {issueItems.length === 0 ? (
              <div className="empty-state">
                <h3>Nebyly nalezeny \u017e\u00e1dn\u00e9 probl\u00e9my</h3>
                <p>Ka\u017ed\u00fd na\u010dten\u00fd \u0159\u00e1dek je p\u0159ipraven\u00fd k importu.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>\u0158\u00e1dek</th>
                      <th>Broker</th>
                      <th>Extern\u00ed ID</th>
                      <th>Symbol</th>
                      <th>Status</th>
                      <th>Probl\u00e9my</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issueItems.map((item) => (
                      <tr key={`issue-${item.broker}-${item.sourceRow}-${item.externalId ?? item.symbol}`}>
                        <td>{item.sourceRow}</td>
                        <td>{item.broker}</td>
                        <td>{renderValue(item.externalId)}</td>
                        <td>{item.symbol}</td>
                        <td>
                          <span className={`badge badge--${item.status}`}>{item.status.toUpperCase()}</span>
                        </td>
                        <td>
                          <div className="issue-list">
                            {item.issues.map((issue, index) => (
                              <span key={`${issue.code}-${index}`}>{issue.message}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Transakce</span>
                <h2>N\u00e1hled normalizovan\u00e9ho ledgeru</h2>
              </div>
            </div>

            {preview.transactions.length === 0 ? (
              <div className="empty-state empty-state--error">
                <h3>\u017d\u00e1dn\u00e9 importovateln\u00e9 transakce</h3>
                <p>Tento report nevytvo\u0159il \u017e\u00e1dn\u00e9 normalizovan\u00e9 BUY/SELL transakce.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Broker</th>
                      <th>Extern\u00ed ID</th>
                      <th>Symbol</th>
                      <th>Leg</th>
                      <th>Typ</th>
                      <th>Portfolio</th>
                      <th>Datum</th>
                      <th>Mno\u017estv\u00ed</th>
                      <th>Cena</th>
                      <th>Poplatek</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.transactions.map((transaction, index) => (
                      <tr
                        key={`${transaction.broker}-${transaction.externalId ?? transaction.symbol}-${transaction.leg ?? index}`}
                      >
                        <td>{transaction.broker}</td>
                        <td>{renderValue(transaction.externalId)}</td>
                        <td>{transaction.symbol}</td>
                        <td>{renderValue(transaction.leg)}</td>
                        <td>
                          <span className={`badge ${transaction.type === "BUY" ? "badge--buy" : "badge--sell"}`}>
                            {transaction.type}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ${transaction.portfolioEligible ? "badge--buy" : "badge--duplicate"}`}
                          >
                            {renderPortfolioBadge(Boolean(transaction.portfolioEligible))}
                          </span>
                        </td>
                        <td>{formatDateTime(transaction.date)}</td>
                        <td>{formatNumber(transaction.quantity)}</td>
                        <td>{formatCurrency(transaction.price, transaction.currency)}</td>
                        <td>{formatCurrency(transaction.fee, transaction.currency)}</td>
                        <td>
                          <span className={`badge badge--${transaction.status}`}>
                            {transaction.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
