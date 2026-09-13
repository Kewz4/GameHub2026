#pragma once

#include <d3d11.h>

#include <cstddef>
#include <cstring>

#include "contract.hpp"

namespace gamehub::overlay::dxgi_d3d11_qa {

template <typename Shader> struct ShaderStageState {
  Shader *shader = nullptr;
  ID3D11ClassInstance *classes[D3D11_SHADER_MAX_INTERFACES]{};
  UINT classCount = D3D11_SHADER_MAX_INTERFACES;
  ID3D11Buffer
      *constantBuffers[D3D11_COMMONSHADER_CONSTANT_BUFFER_API_SLOT_COUNT]{};
  ID3D11ShaderResourceView
      *resources[D3D11_COMMONSHADER_INPUT_RESOURCE_SLOT_COUNT]{};
  ID3D11SamplerState *samplers[D3D11_COMMONSHADER_SAMPLER_SLOT_COUNT]{};
};

struct PipelineState {
  ID3D11InputLayout *inputLayout = nullptr;
  ID3D11Buffer *vertexBuffers[D3D11_IA_VERTEX_INPUT_RESOURCE_SLOT_COUNT]{};
  UINT vertexStrides[D3D11_IA_VERTEX_INPUT_RESOURCE_SLOT_COUNT]{};
  UINT vertexOffsets[D3D11_IA_VERTEX_INPUT_RESOURCE_SLOT_COUNT]{};
  ID3D11Buffer *indexBuffer = nullptr;
  DXGI_FORMAT indexFormat = DXGI_FORMAT_UNKNOWN;
  UINT indexOffset = 0;
  D3D11_PRIMITIVE_TOPOLOGY topology = D3D11_PRIMITIVE_TOPOLOGY_UNDEFINED;

  ShaderStageState<ID3D11VertexShader> vs;
  ShaderStageState<ID3D11HullShader> hs;
  ShaderStageState<ID3D11DomainShader> ds;
  ShaderStageState<ID3D11GeometryShader> gs;
  ShaderStageState<ID3D11PixelShader> ps;
  ShaderStageState<ID3D11ComputeShader> cs;

  ID3D11RasterizerState *rasterizer = nullptr;
  UINT viewportCount = D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE;
  D3D11_VIEWPORT
  viewports[D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE]{};
  UINT scissorCount = D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE;
  D3D11_RECT
  scissors[D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE]{};

  ID3D11RenderTargetView
      *renderTargets[D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT]{};
  ID3D11DepthStencilView *depthStencilView = nullptr;
  ID3D11BlendState *blendState = nullptr;
  FLOAT blendFactor[4]{};
  UINT sampleMask = 0;
  ID3D11DepthStencilState *depthStencilState = nullptr;
  UINT stencilReference = 0;
  ID3D11UnorderedAccessView *omUavs[D3D11_PS_CS_UAV_REGISTER_COUNT]{};
  ID3D11UnorderedAccessView *csUavs[D3D11_PS_CS_UAV_REGISTER_COUNT]{};

  ID3D11Buffer *soTargets[D3D11_SO_BUFFER_SLOT_COUNT]{};
  ID3D11Predicate *predicate = nullptr;
  BOOL predicateValue = FALSE;
};

template <typename T> inline void ReleasePointer(T *&value) noexcept {
  if (value != nullptr) {
    value->Release();
    value = nullptr;
  }
}

template <typename T, std::size_t N>
inline void ReleasePointers(T *(&values)[N]) noexcept {
  for (auto *&value : values)
    ReleasePointer(value);
}

template <typename Shader>
inline void ReleaseStage(ShaderStageState<Shader> *stage) noexcept {
  ReleasePointer(stage->shader);
  ReleasePointers(stage->classes);
  ReleasePointers(stage->constantBuffers);
  ReleasePointers(stage->resources);
  ReleasePointers(stage->samplers);
}

inline void ReleasePipelineState(PipelineState *state) noexcept {
  ReleasePointer(state->inputLayout);
  ReleasePointers(state->vertexBuffers);
  ReleasePointer(state->indexBuffer);
  ReleaseStage(&state->vs);
  ReleaseStage(&state->hs);
  ReleaseStage(&state->ds);
  ReleaseStage(&state->gs);
  ReleaseStage(&state->ps);
  ReleaseStage(&state->cs);
  ReleasePointer(state->rasterizer);
  ReleasePointers(state->renderTargets);
  ReleasePointer(state->depthStencilView);
  ReleasePointer(state->blendState);
  ReleasePointer(state->depthStencilState);
  ReleasePointers(state->omUavs);
  ReleasePointers(state->csUavs);
  ReleasePointers(state->soTargets);
  ReleasePointer(state->predicate);
}

inline DWORD CapturePipelineState(ID3D11DeviceContext *context,
                                  PipelineState *state) noexcept {
  if (context == nullptr || state == nullptr)
    return 0;
  *state = {};
  context->IAGetInputLayout(&state->inputLayout);
  context->IAGetVertexBuffers(0, D3D11_IA_VERTEX_INPUT_RESOURCE_SLOT_COUNT,
                              state->vertexBuffers, state->vertexStrides,
                              state->vertexOffsets);
  context->IAGetIndexBuffer(&state->indexBuffer, &state->indexFormat,
                            &state->indexOffset);
  context->IAGetPrimitiveTopology(&state->topology);

#define GAMEHUB_CAPTURE_STAGE(prefix, member)                                  \
  state->member.classCount = D3D11_SHADER_MAX_INTERFACES;                      \
  context->prefix##GetShader(&state->member.shader, state->member.classes,     \
                             &state->member.classCount);                       \
  if (state->member.shader == nullptr)                                         \
    state->member.classCount = 0;                                              \
  context->prefix##GetConstantBuffers(                                         \
      0, D3D11_COMMONSHADER_CONSTANT_BUFFER_API_SLOT_COUNT,                    \
      state->member.constantBuffers);                                          \
  context->prefix##GetShaderResources(                                         \
      0, D3D11_COMMONSHADER_INPUT_RESOURCE_SLOT_COUNT,                         \
      state->member.resources);                                                \
  context->prefix##GetSamplers(0, D3D11_COMMONSHADER_SAMPLER_SLOT_COUNT,       \
                               state->member.samplers)
  GAMEHUB_CAPTURE_STAGE(VS, vs);
  GAMEHUB_CAPTURE_STAGE(HS, hs);
  GAMEHUB_CAPTURE_STAGE(DS, ds);
  GAMEHUB_CAPTURE_STAGE(GS, gs);
  GAMEHUB_CAPTURE_STAGE(PS, ps);
  GAMEHUB_CAPTURE_STAGE(CS, cs);
#undef GAMEHUB_CAPTURE_STAGE

  context->RSGetState(&state->rasterizer);
  state->viewportCount =
      D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE;
  context->RSGetViewports(&state->viewportCount, state->viewports);
  state->scissorCount =
      D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE;
  context->RSGetScissorRects(&state->scissorCount, state->scissors);

  context->OMGetRenderTargets(D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT,
                              state->renderTargets, &state->depthStencilView);
  context->OMGetBlendState(&state->blendState, state->blendFactor,
                           &state->sampleMask);
  context->OMGetDepthStencilState(&state->depthStencilState,
                                  &state->stencilReference);
  context->OMGetRenderTargetsAndUnorderedAccessViews(
      0, nullptr, nullptr, 0, D3D11_PS_CS_UAV_REGISTER_COUNT, state->omUavs);
  context->CSGetUnorderedAccessViews(0, D3D11_PS_CS_UAV_REGISTER_COUNT,
                                     state->csUavs);
  context->SOGetTargets(D3D11_SO_BUFFER_SLOT_COUNT, state->soTargets);
  context->GetPredication(&state->predicate, &state->predicateValue);
  return kD3d11BaseGetterVisibleStateMask;
}

inline bool QaOmLayoutSupported(const PipelineState &state) noexcept {
  if (state.omUavs[0] != nullptr)
    return false;
  for (UINT index = kQaOmRenderTargetCount;
       index < D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT; ++index) {
    if (state.renderTargets[index] != nullptr)
      return false;
  }
  return true;
}

inline void RestorePipelineState(ID3D11DeviceContext *context,
                                 const PipelineState &state) noexcept {
  context->IASetInputLayout(state.inputLayout);
  context->IASetVertexBuffers(0, D3D11_IA_VERTEX_INPUT_RESOURCE_SLOT_COUNT,
                              state.vertexBuffers, state.vertexStrides,
                              state.vertexOffsets);
  context->IASetIndexBuffer(state.indexBuffer, state.indexFormat,
                            state.indexOffset);
  context->IASetPrimitiveTopology(state.topology);

#define GAMEHUB_RESTORE_STAGE(prefix, member)                                  \
  context->prefix##SetShader(state.member.shader, state.member.classes,        \
                             state.member.classCount);                         \
  context->prefix##SetConstantBuffers(                                         \
      0, D3D11_COMMONSHADER_CONSTANT_BUFFER_API_SLOT_COUNT,                    \
      state.member.constantBuffers);                                           \
  context->prefix##SetShaderResources(                                         \
      0, D3D11_COMMONSHADER_INPUT_RESOURCE_SLOT_COUNT,                         \
      state.member.resources);                                                 \
  context->prefix##SetSamplers(0, D3D11_COMMONSHADER_SAMPLER_SLOT_COUNT,       \
                               state.member.samplers)
  GAMEHUB_RESTORE_STAGE(VS, vs);
  GAMEHUB_RESTORE_STAGE(HS, hs);
  GAMEHUB_RESTORE_STAGE(DS, ds);
  GAMEHUB_RESTORE_STAGE(GS, gs);
  GAMEHUB_RESTORE_STAGE(PS, ps);
  GAMEHUB_RESTORE_STAGE(CS, cs);
#undef GAMEHUB_RESTORE_STAGE

  context->RSSetState(state.rasterizer);
  context->RSSetViewports(state.viewportCount, state.viewports);
  context->RSSetScissorRects(state.scissorCount, state.scissors);

  UINT preserve[D3D11_PS_CS_UAV_REGISTER_COUNT];
  for (UINT &value : preserve)
    value = D3D11_KEEP_UNORDERED_ACCESS_VIEWS;
  context->OMSetRenderTargetsAndUnorderedAccessViews(
      kQaOmRenderTargetCount, state.renderTargets, state.depthStencilView,
      kQaOmUavStartSlot, kQaOmUavCount, state.omUavs + kQaOmUavStartSlot,
      preserve + kQaOmUavStartSlot);
  context->OMSetBlendState(state.blendState, state.blendFactor,
                           state.sampleMask);
  context->OMSetDepthStencilState(state.depthStencilState,
                                  state.stencilReference);
  context->CSSetUnorderedAccessViews(0, D3D11_PS_CS_UAV_REGISTER_COUNT,
                                     state.csUavs, preserve);

  UINT so_offsets[D3D11_SO_BUFFER_SLOT_COUNT];
  for (UINT index = 0; index < D3D11_SO_BUFFER_SLOT_COUNT; ++index) {
    so_offsets[index] =
        state.soTargets[index] == nullptr ? 0u : D3D11_APPEND_ALIGNED_ELEMENT;
  }
  context->SOSetTargets(D3D11_SO_BUFFER_SLOT_COUNT, state.soTargets,
                        so_offsets);
  context->SetPredication(state.predicate, state.predicateValue);
}

template <typename T>
inline bool StateBytesEqual(const T &left, const T &right) noexcept {
  return std::memcmp(&left, &right, sizeof(T)) == 0;
}

template <typename Shader>
inline bool ShaderStageEqual(const ShaderStageState<Shader> &left,
                             const ShaderStageState<Shader> &right) noexcept {
  return left.shader == right.shader &&
         StateBytesEqual(left.classes, right.classes) &&
         left.classCount == right.classCount &&
         StateBytesEqual(left.constantBuffers, right.constantBuffers) &&
         StateBytesEqual(left.resources, right.resources) &&
         StateBytesEqual(left.samplers, right.samplers);
}

inline DWORD PipelineDifferenceMask(const PipelineState &left,
                                    const PipelineState &right) noexcept {
  DWORD mask = 0;
  if (left.inputLayout != right.inputLayout ||
      !StateBytesEqual(left.vertexBuffers, right.vertexBuffers) ||
      !StateBytesEqual(left.vertexStrides, right.vertexStrides) ||
      !StateBytesEqual(left.vertexOffsets, right.vertexOffsets) ||
      left.indexBuffer != right.indexBuffer ||
      left.indexFormat != right.indexFormat ||
      left.indexOffset != right.indexOffset ||
      left.topology != right.topology) {
    mask |= kStateIa;
  }
#define GAMEHUB_COMPARE_STAGE(member, bit)                                     \
  if (!ShaderStageEqual(left.member, right.member))                            \
  mask |= bit
  GAMEHUB_COMPARE_STAGE(vs, kStateVs);
  GAMEHUB_COMPARE_STAGE(hs, kStateHs);
  GAMEHUB_COMPARE_STAGE(ds, kStateDs);
  GAMEHUB_COMPARE_STAGE(gs, kStateGs);
  GAMEHUB_COMPARE_STAGE(ps, kStatePs);
  GAMEHUB_COMPARE_STAGE(cs, kStateCs);
#undef GAMEHUB_COMPARE_STAGE
  if (left.rasterizer != right.rasterizer ||
      left.viewportCount != right.viewportCount ||
      !StateBytesEqual(left.viewports, right.viewports) ||
      left.scissorCount != right.scissorCount ||
      !StateBytesEqual(left.scissors, right.scissors)) {
    mask |= kStateRs;
  }
  if (!StateBytesEqual(left.renderTargets, right.renderTargets) ||
      left.depthStencilView != right.depthStencilView) {
    mask |= kStateOmTargets;
  }
  if (left.blendState != right.blendState ||
      !StateBytesEqual(left.blendFactor, right.blendFactor) ||
      left.sampleMask != right.sampleMask) {
    mask |= kStateOmBlend;
  }
  if (left.depthStencilState != right.depthStencilState ||
      left.stencilReference != right.stencilReference) {
    mask |= kStateOmDepth;
  }
  if (!StateBytesEqual(left.omUavs, right.omUavs))
    mask |= kStateOmUav;
  if (!StateBytesEqual(left.csUavs, right.csUavs))
    mask |= kStateCsUav;
  if (!StateBytesEqual(left.soTargets, right.soTargets))
    mask |= kStateSo;
  if (left.predicate != right.predicate ||
      left.predicateValue != right.predicateValue) {
    mask |= kStatePredication;
  }
  return mask;
}

} // namespace gamehub::overlay::dxgi_d3d11_qa
