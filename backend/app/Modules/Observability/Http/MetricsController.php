<?php

declare(strict_types=1);

namespace App\Modules\Observability\Http;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class MetricsController
{
    public function __invoke(Request $request)
    {
        abort_unless($request->user()->isAdministrator(), 403);
        $lines = ['# HELP document_versions Number of document versions by processing status.', '# TYPE document_versions gauge'];
        foreach (DB::table('document_versions')->selectRaw('status, count(*) as total')->groupBy('status')->get() as $row) {
            if (preg_match('/^[a-z_]+$/D', $row->status)) {
                $lines[] = 'document_versions{status="'.$row->status.'"} '.$row->total;
            }
        }
        $lines[] = '# TYPE outbox_pending gauge';
        $lines[] = 'outbox_pending '.DB::table('outbox_events')->whereNull('dispatched_at')->count();
        $lines[] = '# TYPE queue_failed_jobs gauge';
        $lines[] = 'queue_failed_jobs '.DB::table('failed_jobs')->count();
        $lines[] = '# TYPE transfers_total gauge';
        foreach (DB::table('cloud_transfers')->selectRaw('status,count(*) as total')->groupBy('status')->get() as $row) {
            if (preg_match('/^[a-z_]+$/D', $row->status)) {
                $lines[] = 'transfers_total{status="'.$row->status.'"} '.$row->total;
            }
        }

        return response(implode("\n", $lines)."\n")->header('Content-Type', 'text/plain; version=0.0.4')->header('Cache-Control', 'no-store');
    }
}
