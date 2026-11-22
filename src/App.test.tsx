import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('LogLens workflow', () => {
  it('analyzes the demo log with counts, groups and a timeline', () => {
    window.location.hash = '/analyze';
    render(<App />);
    expect(screen.getByRole('img', { name: /Log volume over time/ })).toBeInTheDocument();
    expect(screen.getByText('Repeated errors')).toBeInTheDocument();
    expect(screen.getAllByText('Demo data').length).toBeGreaterThan(0);
  });

  it('filters by severity, regex search and source', async () => {
    window.location.hash = '/analyze';
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Errors only' }));
    const shown = screen.getByTestId('shown').textContent!;
    expect(Number(shown.split(' ')[0])).toBeGreaterThan(10);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '/declined/' } });
    expect(screen.getAllByText(/Card declined/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '/(/' } });
    expect(screen.getByText(/Invalid pattern/)).toBeInTheDocument();
    expect(screen.getByText('No entries match')).toBeInTheDocument();
  });

  it('analyzes pasted lines and rejects empty paste', async () => {
    window.location.hash = '/analyze';
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Paste log lines'));
    await user.click(screen.getByRole('button', { name: 'Analyze pasted lines' }));
    expect(screen.getByText('Paste some log lines first.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Paste log lines'), { target: { value: '2026-03-04T10:00:00Z ERROR [x] boom\n2026-03-04T10:00:05Z INFO [x] fine' } });
    await user.click(screen.getByRole('button', { name: 'Analyze pasted lines' }));
    expect(screen.getByTestId('shown')).toHaveTextContent('2 of 2 shown');
  });

  it('rejects oversized files and loads text files', async () => {
    window.location.hash = '/analyze';
    render(<App />);
    const input = document.getElementById('file') as HTMLInputElement;
    const big = new File(['x'], 'huge.log');
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(/The limit is 5 MB/)).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File(['2026-03-04T10:00:00Z WARN [a] careful'], 'small.log')] } });
    await waitFor(() => expect(screen.getByTestId('shown')).toHaveTextContent('1 of 1 shown'));
  });

  it('shows the empty state after clearing', async () => {
    window.location.hash = '/analyze';
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No log loaded')).toBeInTheDocument();
  });
});
