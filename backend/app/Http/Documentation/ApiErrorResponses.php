<?php

declare(strict_types=1);

namespace App\Http\Documentation;

use Dedoc\Scramble\Contracts\DocumentTransformer;
use Dedoc\Scramble\OpenApiContext;
use Dedoc\Scramble\Support\Generator\Header;
use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types\ArrayType;
use Dedoc\Scramble\Support\Generator\Types\ObjectType;
use Dedoc\Scramble\Support\Generator\Types\StringType;

final class ApiErrorResponses implements DocumentTransformer
{
    public function handle(OpenApi $document, OpenApiContext $context): void
    {
        $error = (new ObjectType)
            ->addProperty('code', new StringType)
            ->addProperty('message', new StringType)
            ->addProperty('details', (new ObjectType)->additionalProperties((new ArrayType)->setItems(new StringType)))
            ->addProperty('request_id', (new StringType)->format('uuid'))
            ->setRequired(['code', 'message', 'details', 'request_id']);
        $schema = $document->components->addSchema('ApiError', Schema::fromType((new ObjectType)->addProperty('error', $error)->setRequired(['error'])));
        foreach ($document->paths as $path) {
            foreach ($path->operations as $operation) {
                foreach ($operation->responses ?? [] as $response) {
                    $response = $response instanceof Reference ? $response->resolve() : $response;
                    if (! $response instanceof Response || (int) $response->code < 400) {
                        continue;
                    }
                    $response->content = ['application/json' => $schema];
                    if ((int) $response->code === 429) {
                        $response->addHeader('Retry-After', new Header(description: 'Seconds before retrying the operation.', required: true, schema: Schema::fromType(new StringType)));
                    }
                }
            }
        }
    }
}
