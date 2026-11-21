<?php

declare(strict_types=1);

namespace App\Modules\Observability\Services;

use Illuminate\Support\Facades\DB;

final class PrometheusMetricsCollector
{
    /** @return list<string> */
    public function collect(): array
    {
        return [
            ...$this->getDocumentVersionGaugeLines(),
            ...$this->getPendingOutboxGaugeLines(),
            ...$this->getFailedJobGaugeLines(),
            ...$this->getStatusGaugeLines('transfers_total', 'cloud_transfers'),
        ];
    }

    /** @return list<string> */
    private function getDocumentVersionGaugeLines(): array
    {
        return [
            '# HELP document_versions Number of document versions by processing status.',
            ...$this->getStatusGaugeLines('document_versions', 'document_versions'),
        ];
    }

    /** @return list<string> */
    private function getPendingOutboxGaugeLines(): array
    {
        $count = DB::table('outbox_events')
            ->whereNull('dispatched_at')
            ->count();

        return [
            '# TYPE outbox_pending gauge',
            'outbox_pending '.$count,
        ];
    }

    /** @return list<string> */
    private function getFailedJobGaugeLines(): array
    {
        $count = DB::table('failed_jobs')->count();

        return [
            '# TYPE queue_failed_jobs gauge',
            'queue_failed_jobs '.$count,
        ];
    }

    /** @return list<string> */
    private function getStatusGaugeLines(string $metric, string $table): array
    {
        $totals = DB::table($table)
            ->select('status')
            ->selectRaw('count(*) as total')
            ->groupBy('status')
            ->get();

        $lines = ["# TYPE {$metric} gauge"];
        foreach ($totals as $row) {
            if (preg_match('/^[a-z_]+$/D', $row->status) === 1) {
                $lines[] = sprintf('%s{status="%s"} %s', $metric, $row->status, $row->total);
            }
        }

        return $lines;
    }
}
