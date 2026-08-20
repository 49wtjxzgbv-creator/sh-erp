/**
 * jsdom has no real layout engine, so the actual production bug (an
 * ancestor's `overflow:auto` clipping `elementFromPoint()` hit-testing
 * inside a <table>) cannot be reproduced pixel-for-pixel here — that's
 * covered by the plan's manual/live verification pass instead. What IS
 * meaningfully testable under jsdom: that results render in a Radix
 * portal OUTSIDE the input's own DOM subtree (so no ancestor of the
 * input — including a clipping table wrapper — can ever clip them by
 * construction), that a real click still selects an option, and that the
 * keyboard navigation this component adds (previously absent from every
 * picker) works.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { EntityCombobox } from './entity-combobox';

// jsdom implements neither of these, and Radix's Popper/Popover positioning
// logic (used internally, even though position is irrelevant under jsdom)
// touches both.
beforeAll(() => {
  if (!('ResizeObserver' in global)) {
    (global as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

interface Item {
  id: string;
  name: string;
}

const ITEMS: Item[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
  { id: '3', name: 'Gamma' },
];

function Harness({ onSelect }: { onSelect: (item: Item) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const items = open ? ITEMS.filter((i) => i.name.toLowerCase().includes(query.toLowerCase())) : ITEMS;

  return (
    <div style={{ overflow: 'auto', maxHeight: '10px' }} data-testid="clipping-ancestor">
      <EntityCombobox
        query={query}
        onQueryChange={setQuery}
        open={open}
        onOpenChange={setOpen}
        items={items}
        getKey={(item) => item.id}
        onSelect={(item) => {
          setQuery(item.name);
          setOpen(false);
          onSelect(item);
        }}
        renderItem={(item) => <span>{item.name}</span>}
        placeholder="Search…"
      />
    </div>
  );
}

describe('EntityCombobox', () => {
  it('renders its option list outside the clipping ancestor’s DOM subtree (Radix portal)', () => {
    render(<Harness onSelect={() => {}} />);
    fireEvent.focus(screen.getByRole('combobox'));

    const clippingAncestor = screen.getByTestId('clipping-ancestor');
    const option = screen.getByText('Alpha');
    expect(within(clippingAncestor).queryByText('Alpha')).toBeNull();
    expect(clippingAncestor.contains(option)).toBe(false);
  });

  it('a real click on an option selects it, even though its ancestor chain never includes the clipping div', () => {
    const onSelect = jest.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.focus(screen.getByRole('combobox'));

    fireEvent.mouseDown(screen.getByText('Beta'));

    expect(onSelect).toHaveBeenCalledWith({ id: '2', name: 'Beta' });
    expect(screen.getByRole('combobox')).toHaveValue('Beta');
  });

  it('ArrowDown moves the highlighted option and Enter selects it', () => {
    const onSelect = jest.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    // Alpha is highlighted by default (index 0); move to Beta.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith({ id: '2', name: 'Beta' });
  });

  it('Escape closes the list without selecting anything', () => {
    const onSelect = jest.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(screen.getByText('Alpha')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });
});
