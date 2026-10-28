using System;
using System.Collections.Generic;

namespace Example.App
{
    public interface IStore
    {
        void Save(string key);
    }

    public class Store : IStore
    {
        public Store()
        {
        }

        public void Save(string key)
        {
            Console.WriteLine("{" + key);
        }

        private async Task<int> LoadAsync(int id)
        {
            return await Task.FromResult(id);
        }
    }
}
