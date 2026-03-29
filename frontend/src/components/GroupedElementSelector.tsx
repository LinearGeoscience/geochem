import React, { useMemo, useState, useCallback } from 'react';
import { ColumnGeochemMapping } from '../types/associations';
import { CustomAssociation } from '../types/associations';
import { categorizeColumns } from '../utils/categorizeColumnsForSelection';

interface GroupedElementSelectorProps {
  numericColumns: string[];
  geochemMappings: ColumnGeochemMapping[];
  selectedColumns: string[];
  onSelectionChange: (columns: string[]) => void;
  customAssociations?: CustomAssociation[];
  maxHeight?: string;
}

export const GroupedElementSelector: React.FC<GroupedElementSelectorProps> = ({
  numericColumns,
  geochemMappings,
  selectedColumns,
  onSelectionChange,
  customAssociations,
  maxHeight = '300px',
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['otherNumeric']));

  const categorized = useMemo(
    () => categorizeColumns(numericColumns, geochemMappings),
    [numericColumns, geochemMappings]
  );

  // All element columns (excluding otherNumeric)
  const allElementColumns = useMemo(
    () => [...categorized.majorOxides, ...categorized.traceElements, ...categorized.ree],
    [categorized]
  );

  const toggleColumn = useCallback((col: string) => {
    if (selectedColumns.includes(col)) {
      onSelectionChange(selectedColumns.filter(c => c !== col));
    } else {
      onSelectionChange([...selectedColumns, col]);
    }
  }, [selectedColumns, onSelectionChange]);

  const toggleGroup = useCallback((groupColumns: string[]) => {
    const allSelected = groupColumns.every(c => selectedColumns.includes(c));
    if (allSelected) {
      onSelectionChange(selectedColumns.filter(c => !groupColumns.includes(c)));
    } else {
      const newSelection = new Set(selectedColumns);
      groupColumns.forEach(c => newSelection.add(c));
      onSelectionChange(Array.from(newSelection));
    }
  }, [selectedColumns, onSelectionChange]);

  const toggleSectionCollapse = useCallback((section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  const handleAssociationSelect = useCallback((associationId: string) => {
    if (!customAssociations) return;
    const assoc = customAssociations.find(a => a.id === associationId);
    if (assoc) {
      const validColumns = assoc.elements.filter(el => numericColumns.includes(el));
      onSelectionChange(validColumns);
    }
  }, [customAssociations, numericColumns, onSelectionChange]);

  const renderSection = (title: string, columns: string[], sectionKey: string) => {
    if (columns.length === 0) return null;
    const allSelected = columns.every(c => selectedColumns.includes(c));
    const someSelected = columns.some(c => selectedColumns.includes(c));
    const isCollapsed = collapsedSections.has(sectionKey);

    return (
      <div key={sectionKey} style={{ marginBottom: '4px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 8px',
            background: '#f9fafb',
            borderBottom: '1px solid #e5e7eb',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={() => toggleSectionCollapse(sectionKey)}
        >
          <span style={{
            fontSize: '11px',
            marginRight: '6px',
            color: '#6b7280',
            transition: 'transform 0.15s',
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}>
            &#9660;
          </span>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontWeight: 600,
              fontSize: '13px',
              color: '#374151',
              cursor: 'pointer',
              flex: 1,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              onChange={() => toggleGroup(columns)}
              style={{ marginRight: '6px' }}
            />
            {title} ({columns.length})
          </label>
        </div>
        {!isCollapsed && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            padding: '4px 8px',
            gap: '2px',
          }}>
            {columns.map(col => (
              <label
                key={col}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  borderRadius: '3px',
                  background: selectedColumns.includes(col) ? '#eff6ff' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedColumns.includes(col)}
                  onChange={() => toggleColumn(col)}
                  style={{ marginRight: '5px' }}
                />
                <span>{col}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
        Select Elements ({selectedColumns.length} selected)
      </label>

      {/* Action bar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        marginBottom: '8px',
        alignItems: 'center',
      }}>
        <button
          onClick={() => onSelectionChange(allElementColumns)}
          style={{
            padding: '4px 8px',
            fontSize: '12px',
            borderRadius: '4px',
            border: '1px solid #d1d5db',
            background: 'white',
            cursor: 'pointer',
          }}
        >
          Select All Elements
        </button>
        <button
          onClick={() => onSelectionChange([])}
          style={{
            padding: '4px 8px',
            fontSize: '12px',
            borderRadius: '4px',
            border: '1px solid #d1d5db',
            background: 'white',
            cursor: 'pointer',
          }}
        >
          Clear All
        </button>
        {customAssociations && customAssociations.length > 0 && (
          <select
            value=""
            onChange={(e) => handleAssociationSelect(e.target.value)}
            style={{
              padding: '4px 8px',
              fontSize: '12px',
              borderRadius: '4px',
              border: '1px solid #93c5fd',
              background: '#eff6ff',
              cursor: 'pointer',
              color: '#1e40af',
            }}
          >
            <option value="" disabled>Load from PCA Association...</option>
            {customAssociations.map(assoc => (
              <option key={assoc.id} value={assoc.id}>
                {assoc.name} ({assoc.elementSymbols.join(', ')}) - PC{assoc.pcNumber} {assoc.side}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Grouped element list */}
      <div style={{
        maxHeight,
        overflow: 'auto',
        border: '1px solid #d1d5db',
        borderRadius: '4px',
      }}>
        {renderSection('Major Oxides', categorized.majorOxides, 'majorOxides')}
        {renderSection('Trace Elements', categorized.traceElements, 'traceElements')}
        {renderSection('Rare Earth Elements', categorized.ree, 'ree')}
        {renderSection('Other Numeric', categorized.otherNumeric, 'otherNumeric')}
      </div>
    </div>
  );
};
