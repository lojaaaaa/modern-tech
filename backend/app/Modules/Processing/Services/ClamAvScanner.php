<?php

declare(strict_types=1);

namespace App\Modules\Processing\Services;

use RuntimeException;

final class ClamAvScanner implements VirusScanner
{
    public function assertClean(string $path): void
    {
        $socket = @stream_socket_client('tcp://'.config('processing.clamav_host').':'.config('processing.clamav_port'), $errno, $error, 10);
        if (! $socket) {
            throw new RuntimeException('SCANNER_UNAVAILABLE');
        }
        stream_set_timeout($socket, 120);
        $input = fopen($path, 'rb');
        if (! $input) {
            fclose($socket);
            throw new RuntimeException('ORIGINAL_UNAVAILABLE');
        }
        try {
            $this->write($socket, "zINSTREAM\0");
            while (! feof($input)) {
                $chunk = fread($input, 65536);
                if ($chunk === false) {
                    throw new RuntimeException('ORIGINAL_READ_FAILED');
                } if ($chunk !== '') {
                    $this->write($socket, pack('N', strlen($chunk)).$chunk);
                }
            }
            $this->write($socket, pack('N', 0));
            $reply = stream_get_line($socket, 4096, "\0");
            if ($reply !== false && str_ends_with(trim($reply), 'FOUND')) {
                throw new RuntimeException('FILE_INFECTED');
            }
            if ($reply === false || trim($reply) !== 'stream: OK') {
                throw new RuntimeException('SCAN_FAILED');
            }
        } finally {
            fclose($input);
            fclose($socket);
        }
    }

    /** @param resource $socket */
    private function write($socket, string $data): void
    {
        while ($data !== '') {
            $written = fwrite($socket, $data);
            if ($written === false || $written === 0) {
                throw new RuntimeException('SCAN_CONNECTION_LOST');
            } $data = substr($data, $written);
        }
    }
}
