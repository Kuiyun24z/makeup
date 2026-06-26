using System.Text;
using Windows.Media.SpeechSynthesis;

namespace WinRtLocalTts;

internal static class Program
{
  public static async Task<int> Main(string[] args)
  {
    if (args.Length == 1 && string.Equals(args[0], "--list-voices", StringComparison.OrdinalIgnoreCase))
    {
      var voices = SpeechSynthesizer.AllVoices
        .Select((voice) => new
        {
          displayName = voice.DisplayName,
          language = voice.Language,
          gender = voice.Gender.ToString(),
        });
      Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(voices));
      return 0;
    }

    if (args.Length < 2)
    {
      Console.Error.WriteLine("Usage: WinRtLocalTts <base64Text> <outputPath> [voiceName]");
      return 1;
    }

    var base64Text = args[0];
    var outputPath = args[1];
    var requestedVoiceName = args.Length >= 3 ? args[2] : "Microsoft Yaoyao";
    var text = Encoding.UTF8.GetString(Convert.FromBase64String(base64Text));

    using var synth = new SpeechSynthesizer();
    var voice = ResolveVoice(requestedVoiceName);
    if (voice is null)
    {
      Console.Error.WriteLine("No local WinRT voice was found.");
      return 2;
    }

    synth.Voice = voice;
    using var stream = await synth.SynthesizeTextToStreamAsync(text);
    using var input = stream.AsStreamForRead();
    using var output = File.Create(outputPath);
    await input.CopyToAsync(output);

    Console.WriteLine(voice.DisplayName);
    return 0;
  }

  private static VoiceInformation? ResolveVoice(string requestedVoiceName)
  {
    return SpeechSynthesizer.AllVoices.FirstOrDefault(item =>
      string.Equals(item.DisplayName, requestedVoiceName, StringComparison.OrdinalIgnoreCase)
    ) ?? SpeechSynthesizer.AllVoices.FirstOrDefault(item =>
      item.Language.StartsWith("zh", StringComparison.OrdinalIgnoreCase)
      && item.Gender == VoiceGender.Female
    ) ?? SpeechSynthesizer.AllVoices.FirstOrDefault();
  }
}
