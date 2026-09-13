#include "host_state.hpp"

#include <d3dcompiler.h>

#include <cstring>

namespace gamehub::overlay::dxgi_d3d11_qa {
namespace {

template <typename T> void SafeRelease(T *&value) noexcept {
  if (value != nullptr) {
    value->Release();
    value = nullptr;
  }
}

HRESULT Compile(const char *source, const char *entry, const char *target,
                ID3DBlob **bytecode) noexcept {
  ID3DBlob *errors = nullptr;
  const HRESULT result = D3DCompile(
      source, std::strlen(source), "gamehub-d3d11-host-state", nullptr, nullptr,
      entry, target, D3DCOMPILE_ENABLE_STRICTNESS, 0, bytecode, &errors);
  SafeRelease(errors);
  return result;
}

HRESULT CreateBuffer(ID3D11Device *device, UINT byte_width, UINT bind_flags,
                     UINT misc_flags, UINT stride, const void *data,
                     ID3D11Buffer **output) noexcept {
  D3D11_BUFFER_DESC description{};
  description.ByteWidth = byte_width;
  description.Usage = D3D11_USAGE_DEFAULT;
  description.BindFlags = bind_flags;
  description.MiscFlags = misc_flags;
  description.StructureByteStride = stride;
  D3D11_SUBRESOURCE_DATA initial{};
  initial.pSysMem = data;
  return device->CreateBuffer(&description,
                              data == nullptr ? nullptr : &initial, output);
}

template <typename Shader>
bool StageIsSeeded(const ShaderStageState<Shader> &stage) noexcept {
  return stage.shader != nullptr && stage.constantBuffers[0] != nullptr &&
         stage.resources[0] != nullptr && stage.samplers[0] != nullptr;
}

DWORD NonNullMask(const PipelineState &state) noexcept {
  DWORD mask = 0;
  if (state.inputLayout != nullptr && state.vertexBuffers[0] != nullptr &&
      state.indexBuffer != nullptr &&
      state.topology != D3D11_PRIMITIVE_TOPOLOGY_UNDEFINED) {
    mask |= kStateIa;
  }
  if (StageIsSeeded(state.vs))
    mask |= kStateVs;
  if (StageIsSeeded(state.hs))
    mask |= kStateHs;
  if (StageIsSeeded(state.ds))
    mask |= kStateDs;
  if (StageIsSeeded(state.gs))
    mask |= kStateGs;
  if (StageIsSeeded(state.ps))
    mask |= kStatePs;
  if (StageIsSeeded(state.cs))
    mask |= kStateCs;
  if (state.rasterizer != nullptr && state.viewportCount == 1u &&
      state.scissorCount == 1u) {
    mask |= kStateRs;
  }
  if (state.renderTargets[0] != nullptr && state.depthStencilView != nullptr) {
    mask |= kStateOmTargets;
  }
  if (state.blendState != nullptr)
    mask |= kStateOmBlend;
  if (state.depthStencilState != nullptr)
    mask |= kStateOmDepth;
  if (state.omUavs[1] != nullptr)
    mask |= kStateOmUav;
  if (state.csUavs[0] != nullptr)
    mask |= kStateCsUav;
  if (state.soTargets[0] != nullptr)
    mask |= kStateSo;
  if (state.predicate != nullptr)
    mask |= kStatePredication;
  if (state.ps.classCount == 1u && state.ps.classes[0] != nullptr) {
    mask |= kStateClassInstances;
  }
  return mask;
}

} // namespace

HRESULT SeedNonNullHostState(ID3D11Device *device, ID3D11DeviceContext *context,
                             IDXGISwapChain *swap_chain,
                             SeededHostState *output) noexcept {
  if (device == nullptr || context == nullptr || swap_chain == nullptr ||
      output == nullptr) {
    return E_INVALIDARG;
  }
  static constexpr char kVs[] =
      "struct V{float3 p:POSITION;};float4 main(V v):SV_Position{"
      "return float4(v.p,1);}";
  static constexpr char kHs[] =
      "struct C{float4 p:SV_Position;};struct K{float e[3]:SV_TessFactor;"
      "float i:SV_InsideTessFactor;};K pc(InputPatch<C,3> p){K k;"
      "k.e[0]=k.e[1]=k.e[2]=1;k.i=1;return k;}"
      "[domain(\"tri\")][partitioning(\"integer\")]"
      "[outputtopology(\"triangle_cw\")][outputcontrolpoints(3)]"
      "[patchconstantfunc(\"pc\")]C main(InputPatch<C,3> p,"
      "uint id:SV_OutputControlPointID){return p[id];}";
  static constexpr char kDs[] =
      "struct C{float4 p:SV_Position;};struct K{float e[3]:SV_TessFactor;"
      "float i:SV_InsideTessFactor;};[domain(\"tri\")]float4 main(K k,"
      "float3 b:SV_DomainLocation,const OutputPatch<C,3> p):SV_Position{"
      "return p[0].p*b.x+p[1].p*b.y+p[2].p*b.z;}";
  static constexpr char kGs[] =
      "struct C{float4 p:SV_Position;};[maxvertexcount(3)]void main("
      "triangle C input[3],inout TriangleStream<C> outp){outp.Append(input[0]);"
      "outp.Append(input[1]);outp.Append(input[2]);}";
  static constexpr char kPs[] =
      "interface IColor{float4 GetColor();};class CRed:IColor{"
      "float gain;float4 GetColor(){return float4(gain,0,0,1);}};"
      "CRed red;IColor selected;"
      "float4 main():SV_Target{return selected.GetColor();}";
  static constexpr char kCs[] =
      "[numthreads(1,1,1)]void main(uint3 id:SV_DispatchThreadID){}";

  ID3DBlob *vs_blob = nullptr;
  ID3DBlob *hs_blob = nullptr;
  ID3DBlob *ds_blob = nullptr;
  ID3DBlob *gs_blob = nullptr;
  ID3DBlob *ps_blob = nullptr;
  ID3DBlob *cs_blob = nullptr;
  HRESULT result = Compile(kVs, "main", "vs_5_0", &vs_blob);
  if (SUCCEEDED(result))
    result = Compile(kHs, "main", "hs_5_0", &hs_blob);
  if (SUCCEEDED(result))
    result = Compile(kDs, "main", "ds_5_0", &ds_blob);
  if (SUCCEEDED(result))
    result = Compile(kGs, "main", "gs_5_0", &gs_blob);
  if (SUCCEEDED(result))
    result = Compile(kPs, "main", "ps_5_0", &ps_blob);
  if (SUCCEEDED(result))
    result = Compile(kCs, "main", "cs_5_0", &cs_blob);

  ID3D11VertexShader *vs = nullptr;
  ID3D11HullShader *hs = nullptr;
  ID3D11DomainShader *ds = nullptr;
  ID3D11GeometryShader *gs = nullptr;
  ID3D11PixelShader *ps = nullptr;
  ID3D11ComputeShader *cs = nullptr;
  ID3D11ClassLinkage *linkage = nullptr;
  ID3D11ClassInstance *class_instance = nullptr;
  ID3D11InputLayout *input_layout = nullptr;
  if (SUCCEEDED(result)) {
    result = device->CreateVertexShader(vs_blob->GetBufferPointer(),
                                        vs_blob->GetBufferSize(), nullptr, &vs);
  }
  if (SUCCEEDED(result)) {
    result = device->CreateHullShader(hs_blob->GetBufferPointer(),
                                      hs_blob->GetBufferSize(), nullptr, &hs);
  }
  if (SUCCEEDED(result)) {
    result = device->CreateDomainShader(ds_blob->GetBufferPointer(),
                                        ds_blob->GetBufferSize(), nullptr, &ds);
  }
  if (SUCCEEDED(result)) {
    result = device->CreateGeometryShader(
        gs_blob->GetBufferPointer(), gs_blob->GetBufferSize(), nullptr, &gs);
  }
  if (SUCCEEDED(result))
    result = device->CreateClassLinkage(&linkage);
  if (SUCCEEDED(result)) {
    result = device->CreatePixelShader(ps_blob->GetBufferPointer(),
                                       ps_blob->GetBufferSize(), linkage, &ps);
  }
  if (SUCCEEDED(result)) {
    result = linkage->GetClassInstance("red", 0, &class_instance);
  }
  if (SUCCEEDED(result)) {
    result = device->CreateComputeShader(
        cs_blob->GetBufferPointer(), cs_blob->GetBufferSize(), nullptr, &cs);
  }
  const D3D11_INPUT_ELEMENT_DESC input_element{
      "POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT,
      0,          0, D3D11_INPUT_PER_VERTEX_DATA,
      0};
  if (SUCCEEDED(result)) {
    result = device->CreateInputLayout(&input_element, 1,
                                       vs_blob->GetBufferPointer(),
                                       vs_blob->GetBufferSize(), &input_layout);
  }

  const FLOAT vertices[9]{-0.5f, -0.5f, 0.0f,  0.0f, 0.5f,
                          0.0f,  0.5f,  -0.5f, 0.0f};
  const UINT16 indices[3]{0, 1, 2};
  const FLOAT constants[4]{1.0f, 2.0f, 3.0f, 4.0f};
  ID3D11Buffer *vertex_buffer = nullptr;
  ID3D11Buffer *index_buffer = nullptr;
  ID3D11Buffer *constant_buffer = nullptr;
  ID3D11Buffer *so_buffer = nullptr;
  if (SUCCEEDED(result)) {
    result = CreateBuffer(device, sizeof(vertices), D3D11_BIND_VERTEX_BUFFER, 0,
                          0, vertices, &vertex_buffer);
  }
  if (SUCCEEDED(result)) {
    result = CreateBuffer(device, sizeof(indices), D3D11_BIND_INDEX_BUFFER, 0,
                          0, indices, &index_buffer);
  }
  if (SUCCEEDED(result)) {
    result = CreateBuffer(device, sizeof(constants), D3D11_BIND_CONSTANT_BUFFER,
                          0, 0, constants, &constant_buffer);
  }
  if (SUCCEEDED(result)) {
    result = CreateBuffer(device, 256, D3D11_BIND_STREAM_OUTPUT, 0, 0, nullptr,
                          &so_buffer);
  }

  const UINT pixels[16]{0xff102030u, 0xff203040u, 0xff304050u, 0xff405060u};
  D3D11_TEXTURE2D_DESC texture_description{};
  texture_description.Width = 4;
  texture_description.Height = 4;
  texture_description.MipLevels = 1;
  texture_description.ArraySize = 1;
  texture_description.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  texture_description.SampleDesc.Count = 1;
  texture_description.Usage = D3D11_USAGE_DEFAULT;
  texture_description.BindFlags = D3D11_BIND_SHADER_RESOURCE;
  D3D11_SUBRESOURCE_DATA texture_data{};
  texture_data.pSysMem = pixels;
  texture_data.SysMemPitch = 4 * sizeof(UINT);
  ID3D11Texture2D *texture = nullptr;
  ID3D11ShaderResourceView *srv = nullptr;
  if (SUCCEEDED(result)) {
    result =
        device->CreateTexture2D(&texture_description, &texture_data, &texture);
  }
  if (SUCCEEDED(result)) {
    result = device->CreateShaderResourceView(texture, nullptr, &srv);
  }
  D3D11_SAMPLER_DESC sampler_description{};
  sampler_description.Filter = D3D11_FILTER_MIN_MAG_MIP_POINT;
  sampler_description.AddressU = D3D11_TEXTURE_ADDRESS_CLAMP;
  sampler_description.AddressV = D3D11_TEXTURE_ADDRESS_CLAMP;
  sampler_description.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
  sampler_description.MaxLOD = D3D11_FLOAT32_MAX;
  ID3D11SamplerState *sampler = nullptr;
  if (SUCCEEDED(result)) {
    result = device->CreateSamplerState(&sampler_description, &sampler);
  }

  ID3D11Buffer *om_uav_buffer = nullptr;
  ID3D11Buffer *cs_uav_buffer = nullptr;
  ID3D11UnorderedAccessView *om_uav = nullptr;
  ID3D11UnorderedAccessView *cs_uav = nullptr;
  if (SUCCEEDED(result)) {
    result = CreateBuffer(device, 64, D3D11_BIND_UNORDERED_ACCESS,
                          D3D11_RESOURCE_MISC_BUFFER_STRUCTURED, sizeof(UINT),
                          nullptr, &om_uav_buffer);
  }
  if (SUCCEEDED(result)) {
    result = CreateBuffer(device, 64, D3D11_BIND_UNORDERED_ACCESS,
                          D3D11_RESOURCE_MISC_BUFFER_STRUCTURED, sizeof(UINT),
                          nullptr, &cs_uav_buffer);
  }
  if (SUCCEEDED(result)) {
    result = device->CreateUnorderedAccessView(om_uav_buffer, nullptr, &om_uav);
  }
  if (SUCCEEDED(result)) {
    result = device->CreateUnorderedAccessView(cs_uav_buffer, nullptr, &cs_uav);
  }

  ID3D11Texture2D *backbuffer = nullptr;
  ID3D11RenderTargetView *render_target = nullptr;
  if (SUCCEEDED(result)) {
    result = swap_chain->GetBuffer(0, IID_PPV_ARGS(&backbuffer));
  }
  if (SUCCEEDED(result)) {
    result =
        device->CreateRenderTargetView(backbuffer, nullptr, &render_target);
  }
  D3D11_TEXTURE2D_DESC backbuffer_description{};
  if (backbuffer != nullptr)
    backbuffer->GetDesc(&backbuffer_description);
  D3D11_TEXTURE2D_DESC depth_description{};
  depth_description.Width = backbuffer_description.Width;
  depth_description.Height = backbuffer_description.Height;
  depth_description.MipLevels = 1;
  depth_description.ArraySize = 1;
  depth_description.Format = DXGI_FORMAT_D24_UNORM_S8_UINT;
  depth_description.SampleDesc = backbuffer_description.SampleDesc;
  depth_description.Usage = D3D11_USAGE_DEFAULT;
  depth_description.BindFlags = D3D11_BIND_DEPTH_STENCIL;
  ID3D11Texture2D *depth_texture = nullptr;
  ID3D11DepthStencilView *depth_view = nullptr;
  if (SUCCEEDED(result)) {
    result =
        device->CreateTexture2D(&depth_description, nullptr, &depth_texture);
  }
  if (SUCCEEDED(result)) {
    result =
        device->CreateDepthStencilView(depth_texture, nullptr, &depth_view);
  }

  D3D11_RASTERIZER_DESC raster_description{};
  raster_description.FillMode = D3D11_FILL_WIREFRAME;
  raster_description.CullMode = D3D11_CULL_NONE;
  raster_description.ScissorEnable = TRUE;
  raster_description.DepthClipEnable = TRUE;
  ID3D11RasterizerState *rasterizer = nullptr;
  if (SUCCEEDED(result)) {
    result = device->CreateRasterizerState(&raster_description, &rasterizer);
  }
  D3D11_BLEND_DESC blend_description{};
  blend_description.RenderTarget[0].BlendEnable = TRUE;
  blend_description.RenderTarget[0].SrcBlend = D3D11_BLEND_SRC_ALPHA;
  blend_description.RenderTarget[0].DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
  blend_description.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD;
  blend_description.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ONE;
  blend_description.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_ZERO;
  blend_description.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD;
  blend_description.RenderTarget[0].RenderTargetWriteMask =
      D3D11_COLOR_WRITE_ENABLE_ALL;
  ID3D11BlendState *blend = nullptr;
  if (SUCCEEDED(result)) {
    result = device->CreateBlendState(&blend_description, &blend);
  }
  D3D11_DEPTH_STENCIL_DESC depth_state_description{};
  depth_state_description.DepthEnable = TRUE;
  depth_state_description.DepthWriteMask = D3D11_DEPTH_WRITE_MASK_ALL;
  depth_state_description.DepthFunc = D3D11_COMPARISON_LESS_EQUAL;
  ID3D11DepthStencilState *depth_state = nullptr;
  if (SUCCEEDED(result)) {
    result =
        device->CreateDepthStencilState(&depth_state_description, &depth_state);
  }
  D3D11_QUERY_DESC query_description{};
  query_description.Query = D3D11_QUERY_OCCLUSION_PREDICATE;
  ID3D11Predicate *predicate = nullptr;
  if (SUCCEEDED(result)) {
    result = device->CreatePredicate(&query_description, &predicate);
  }

  if (SUCCEEDED(result)) {
    const UINT stride = 3 * sizeof(FLOAT);
    const UINT offset = 0;
    context->IASetInputLayout(input_layout);
    context->IASetVertexBuffers(0, 1, &vertex_buffer, &stride, &offset);
    context->IASetIndexBuffer(index_buffer, DXGI_FORMAT_R16_UINT, 0);
    context->IASetPrimitiveTopology(
        D3D11_PRIMITIVE_TOPOLOGY_3_CONTROL_POINT_PATCHLIST);
    ID3D11ClassInstance *ps_classes[]{class_instance};
    context->VSSetShader(vs, nullptr, 0);
    context->HSSetShader(hs, nullptr, 0);
    context->DSSetShader(ds, nullptr, 0);
    context->GSSetShader(gs, nullptr, 0);
    context->PSSetShader(ps, ps_classes, ARRAYSIZE(ps_classes));
    context->CSSetShader(cs, nullptr, 0);
#define GAMEHUB_BIND_STAGE(prefix)                                             \
  context->prefix##SetConstantBuffers(0, 1, &constant_buffer);                 \
  context->prefix##SetShaderResources(0, 1, &srv);                             \
  context->prefix##SetSamplers(0, 1, &sampler)
    GAMEHUB_BIND_STAGE(VS);
    GAMEHUB_BIND_STAGE(HS);
    GAMEHUB_BIND_STAGE(DS);
    GAMEHUB_BIND_STAGE(GS);
    GAMEHUB_BIND_STAGE(PS);
    GAMEHUB_BIND_STAGE(CS);
#undef GAMEHUB_BIND_STAGE
    context->CSSetUnorderedAccessViews(0, 1, &cs_uav, nullptr);
    D3D11_VIEWPORT viewport{};
    viewport.Width = static_cast<FLOAT>(backbuffer_description.Width);
    viewport.Height = static_cast<FLOAT>(backbuffer_description.Height);
    viewport.MaxDepth = 1.0f;
    D3D11_RECT scissor{1, 2, 63, 64};
    context->RSSetState(rasterizer);
    context->RSSetViewports(1, &viewport);
    context->RSSetScissorRects(1, &scissor);
    const FLOAT blend_factor[4]{0.1f, 0.2f, 0.3f, 0.4f};
    const UINT initial_count = 7;
    context->OMSetRenderTargetsAndUnorderedAccessViews(
        1, &render_target, depth_view, 1, 1, &om_uav, &initial_count);
    context->OMSetBlendState(blend, blend_factor, 0x5a5aa5a5u);
    context->OMSetDepthStencilState(depth_state, 37);
    const UINT so_offset = 16;
    context->SOSetTargets(1, &so_buffer, &so_offset);
    context->SetPredication(predicate, TRUE);
    CapturePipelineState(context, &output->retained);
    output->getterVisibleNonNullMask = NonNullMask(output->retained);
    if (output->getterVisibleNonNullMask != kD3d11BaseGetterVisibleStateMask ||
        !QaOmLayoutSupported(output->retained)) {
      result = E_FAIL;
    }
  }

  SafeRelease(predicate);
  SafeRelease(depth_state);
  SafeRelease(blend);
  SafeRelease(rasterizer);
  SafeRelease(depth_view);
  SafeRelease(depth_texture);
  SafeRelease(render_target);
  SafeRelease(backbuffer);
  SafeRelease(cs_uav);
  SafeRelease(om_uav);
  SafeRelease(cs_uav_buffer);
  SafeRelease(om_uav_buffer);
  SafeRelease(sampler);
  SafeRelease(srv);
  SafeRelease(texture);
  SafeRelease(so_buffer);
  SafeRelease(constant_buffer);
  SafeRelease(index_buffer);
  SafeRelease(vertex_buffer);
  SafeRelease(input_layout);
  SafeRelease(class_instance);
  SafeRelease(linkage);
  SafeRelease(cs);
  SafeRelease(ps);
  SafeRelease(gs);
  SafeRelease(ds);
  SafeRelease(hs);
  SafeRelease(vs);
  SafeRelease(cs_blob);
  SafeRelease(ps_blob);
  SafeRelease(gs_blob);
  SafeRelease(ds_blob);
  SafeRelease(hs_blob);
  SafeRelease(vs_blob);
  return result;
}

void ReleaseSeededHostState(ID3D11DeviceContext *context,
                            SeededHostState *state) noexcept {
  if (context != nullptr) {
    context->ClearState();
    context->Flush();
  }
  if (state != nullptr) {
    ReleasePipelineState(&state->retained);
    state->getterVisibleNonNullMask = 0;
  }
}

} // namespace gamehub::overlay::dxgi_d3d11_qa
