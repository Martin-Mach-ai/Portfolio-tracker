type ToolbarOption = {
  label: string;
  value: string;
};

type ToolbarFilter = {
  label: string;
  options: ToolbarOption[];
  value: string;
  onChange: (value: string) => void;
};

type TableToolbarProps = {
  searchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  filters?: ToolbarFilter[];
  sortLabel: string;
  sortOptions: ToolbarOption[];
  sortValue: string;
  onSortChange: (value: string) => void;
  directionLabel: string;
  directionValue: string;
  directionOptions: ToolbarOption[];
  onDirectionChange: (value: string) => void;
};

export function TableToolbar({
  searchLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  filters = [],
  sortLabel,
  sortOptions,
  sortValue,
  onSortChange,
  directionLabel,
  directionValue,
  directionOptions,
  onDirectionChange,
}: TableToolbarProps) {
  return (
    <div className="table-toolbar" role="search">
      <label className="field">
        <span>{searchLabel}</span>
        <input
          aria-label={searchLabel}
          type="search"
          value={searchValue}
          placeholder={searchPlaceholder}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      {filters.map((filter) => (
        <label key={filter.label} className="field">
          <span>{filter.label}</span>
          <select
            aria-label={filter.label}
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
          >
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      <label className="field">
        <span>{sortLabel}</span>
        <select aria-label={sortLabel} value={sortValue} onChange={(event) => onSortChange(event.target.value)}>
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{directionLabel}</span>
        <select
          aria-label={directionLabel}
          value={directionValue}
          onChange={(event) => onDirectionChange(event.target.value)}
        >
          {directionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
