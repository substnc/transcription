"""Kontroll: en slumpad HF-Whisper konverterad till OpenAI-format ger samma utdata.
Körs utan nätverk. Om detta stämmer är nyckelmappningen rätt för riktiga modeller också."""
import torch, whisper
from transformers import WhisperConfig, WhisperForConditionalGeneration
from hf_to_openai import convert

torch.manual_seed(0)
cfg = WhisperConfig(vocab_size=51866, num_mel_bins=128, d_model=64, encoder_layers=2, decoder_layers=2,
                    encoder_attention_heads=4, decoder_attention_heads=4, encoder_ffn_dim=256, decoder_ffn_dim=256,
                    max_source_positions=1500, max_target_positions=448)
hf = WhisperForConditionalGeneration(cfg).eval()
ckpt = convert(hf)
oa = whisper.model.Whisper(whisper.model.ModelDimensions(**ckpt["dims"])).eval()
missing, unexpected = oa.load_state_dict(ckpt["model_state_dict"], strict=False)
assert not unexpected, unexpected
assert not missing, missing

mel = torch.randn(1, 128, 3000)
tokens = torch.tensor([[50258, 50363, 50365, 1000, 2000]])
with torch.no_grad():
    enc_hf = hf.model.encoder(mel).last_hidden_state
    enc_oa = oa.encoder(mel)
    print("encoder max diff:", (enc_hf - enc_oa).abs().max().item())
    logits_hf = hf(input_features=mel, decoder_input_ids=tokens).logits
    logits_oa = oa.decoder(tokens, enc_oa)
    print("decoder max diff:", (logits_hf - logits_oa).abs().max().item())
assert (enc_hf - enc_oa).abs().max() < 1e-4 and (logits_hf - logits_oa).abs().max() < 1e-3
print("OK: konverteringen är numeriskt identisk")
