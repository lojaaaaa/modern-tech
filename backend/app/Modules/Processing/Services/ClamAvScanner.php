<?php

declare(strict_types=1);

namespace App\Modules\Processing\Services;

use App\Modules\Processing\Enums\ProcessingError;
use App\Modules\Processing\Exceptions\ProcessingException;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Support\Facades\Process;

final class ClamAvScanner implements VirusScanner
{
    public function assertClean(string $path): void
    {
        $file = realpath($path);
        if ($file === false || ! is_file($file) || ! is_readable($file)) {
            throw new ProcessingException(ProcessingError::ORIGINAL_UNAVAILABLE);
        }

        $size = filesize($file);
        if ($size === false || $size === 0) {
            throw new ProcessingException(ProcessingError::SCAN_FAILED);
        }

        $config = sprintf(
            "TCPAddr %s\nTCPSocket %d\nStreamMaxLength %d\n",
            config('processing.clamav_host'),
            config('processing.clamav_port'),
            $size,
        );
        try {
            $result = Process::input($config)->timeout(130)->run([
                'clamdscan', '--config-file=/dev/stdin', '--stream', '--no-summary', '--', $file,
            ]);
        } catch (ProcessTimedOutException $error) {
            throw new ProcessingException(ProcessingError::SCANNER_UNAVAILABLE, $error);
        }

        if ($result->exitCode() === 1) {
            throw new ProcessingException(ProcessingError::FILE_INFECTED);
        }
        if (! $result->successful() || trim($result->output()) !== $file . ': OK') {
            throw new ProcessingException(ProcessingError::SCAN_FAILED);
        }
    }
}
