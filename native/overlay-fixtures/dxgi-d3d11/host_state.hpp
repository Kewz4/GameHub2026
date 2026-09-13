#pragma once

#include <d3d11.h>

#include "pipeline_state.hpp"

namespace gamehub::overlay::dxgi_d3d11_qa {

struct SeededHostState {
  PipelineState retained{};
  DWORD getterVisibleNonNullMask = 0;
};

HRESULT SeedNonNullHostState(ID3D11Device *device, ID3D11DeviceContext *context,
                             IDXGISwapChain *swap_chain,
                             SeededHostState *output) noexcept;
void ReleaseSeededHostState(ID3D11DeviceContext *context,
                            SeededHostState *state) noexcept;

} // namespace gamehub::overlay::dxgi_d3d11_qa
